# AgentMail Provider Contract Remediation — Final Report

**Date:** 2026-08-21  
**Scope:** Remediates all 13 open defects identified by independent Codex verification  
**Test result:** 35/35 passing (11 original multi-tenant + 24 new provider-contract tests)  
**Production boundary:** No production DDL executed, no provider inboxes created, no activations performed

---

## Provider Contract — Verified Source

All implementation decisions below are grounded in the **live AgentMail documentation** fetched and read during this session. No claims from the independent Codex verification were accepted without independent doc confirmation.

### Verified facts

| Claim | Source | Verified |
|-------|--------|----------|
| `event_type: "message.received"` is the dispatch field | `docs.agentmail.to/events` | ✅ |
| Email data lives at `event.message` (not `event.email`) | `docs.agentmail.to/events` | ✅ |
| `message.to` is an **array** of RFC 2822 strings | `docs.agentmail.to/events` | ✅ |
| `message.inbox_id` is the authoritative inbox identifier | `docs.agentmail.to/events` | ✅ |
| `message.message_id` is the SMTP Message-ID for dedup | `docs.agentmail.to/events` | ✅ |
| Inbox creation returns `inbox_id` (not `id`) | `docs.agentmail.to/api-reference/inboxes/create-inbox` | ✅ |
| `client_id` parameter makes inbox creation idempotent | `docs.agentmail.to/api-reference/inboxes/create-inbox` | ✅ |
| Webhook auth uses **custom delivery headers** (`Authorization: Bearer <secret>`) | `docs.agentmail.to/webhooks-overview` | ✅ |
| Svix-style HMAC signature | Could **not** be confirmed in official docs | ❌ (unverified) |

> **Note on signature verification:** The Codex report claimed "Svix-style webhook headers/signatures." This could not be verified from official AgentMail documentation — the webhooks security page 404s. The documented mechanism is custom delivery headers. This implementation uses the documented mechanism: timing-safe comparison of `Authorization: Bearer <AGENTMAIL_WEBHOOK_SECRET>`. If AgentMail publishes an HMAC scheme, migration is isolated to `handleAgentMailWebhook()`.

---

## Defects Remediated

### 1 ✅ Wrong event shape (`agentmail-routes.ts` webhook handler)

**Before:** Dispatched on `event.type`; extracted data from `event.email ?? event.data ?? event`; treated `to` as a string.

**After:** Dispatches on `event.event_type`; handles `message.received` and all three sub-classifications; extracts data from `event.message`; handles `message.to` as an array (`toList[0]` for routing); uses `message.message_id` as provider dedup key; uses `message.inbox_id` as primary routing identity.

### 2 ✅ Wrong provider inbox ID field (`agentmail-service.ts`, `agentmail-ownership-service.ts`)

**Before:** `createOrVerifyInbox` read `providerResult.inbox?.id`.

**After:** Reads `providerResult.inbox?.inbox_id` (verified field name). `verifyInboxExists` now returns `{ exists, inboxId?, email? }` so activation can cross-corroborate.

### 3 ✅ Wrong webhook signature scheme (`agentmail-service.ts`)

**Before:** HMAC-SHA256 of `JSON.stringify(req.body)` checked against `x-agentmail-signature`. Three problems: wrong auth mechanism, body re-serialized (not raw bytes), wrong header name.

**After:** Timing-safe comparison of `Authorization: Bearer <AGENTMAIL_WEBHOOK_SECRET>` per verified docs. Comparison uses HMAC-of-both-inputs trick to make `timingSafeEqual` work for inputs of different lengths. `req.body` is passed directly (never `JSON.stringify`). In development (no secret), requests pass with a prominent warning. In production (secret set), unsigned requests return 401.

### 4 ✅ Schema constraints missing (`agentmail-migration.ts`)

**Added:**
- `UNIQUE` partial index on `provider_inbox_id WHERE provider_inbox_id IS NOT NULL` — prevents two orgs sharing a provider identity while allowing multiple unprovisioned rows (NULLs)
- `CHECK (role IN ('revenue','hiring','scheduling','support','operations','ceo'))` constraint
- `CHECK (ownership_state IN ('provisioning','active','disabled','retired'))` constraint

Tests 15 and 16 verify these constraints are enforced correctly.

### 5 ✅ DDL ordering bug (`agentmail-migration.ts`)

**Before:** `ensureOwnershipTable()` ran `ALTER TABLE agent_mail_inbound_messages` before that table was created (fresh-DB failure).

**After:** `agentmail-migration.ts` is a single deterministic ordered migration:
1. `agent_mail_inbound_messages` (with all columns including crash-recovery fields)
2. `org_agentmail_inboxes` (with constraints and partial UNIQUE index)
3. `agent_mail_messages` (outbound audit log)

The migration is idempotent (`CREATE IF NOT EXISTS`, `ADD COLUMN IF NOT EXISTS`), concurrent-safe (single in-flight promise), and guarded by a `isAgentMailSchemaReady()` flag.

### 6 ✅ Quarantine persistence issues (`agentmail-routes.ts`)

**Before:** Quarantine DB insert was `.catch(() => {})` — errors silently swallowed.

**After:** `.catch((e: any) => e)` captures errors and `console.error` logs them. The quarantine row `routing_status` is now explicitly `'quarantine'` (separate from `routing_reason`). `processing_state` is set to `'completed'` for quarantine rows (they will never be retried).

### 7 ✅ Lifecycle auth too permissive (`agentmail-routes.ts`)

**Before:** All 7 ownership routes used `requireRole("COACH", "ADMIN")`.

**After:**
- `GET /api/agentmail/ownership` — `requireRole("COACH", "ADMIN")` (read-only, unchanged)
- `POST /api/agentmail/ownership/verify` — `requireRole("COACH", "ADMIN")` (read-only, unchanged)
- `POST /api/agentmail/ownership/provision` — `requireRole("ADMIN")` ✅ mutates provider state
- `POST /api/agentmail/ownership/activate` — `requireRole("ADMIN")` ✅ mutates ownership_state
- `POST /api/agentmail/ownership/disable/:role` — `requireRole("ADMIN")` ✅ mutates ownership_state
- `POST /api/agentmail/ownership/retire/:role` — `requireRole("ADMIN")` ✅ irreversible
- `POST /api/agentmail/ownership/retire-all` — `requireRole("ADMIN")` ✅ org-wide, irreversible

### 8 ✅ Activation gate missing (`agentmail-ownership-service.ts`)

**Before:** `activateOrgInboxes()` blindly promoted any `provisioning` row to `active`.

**After:** Five gates must all pass before activation:
1. `provider_inbox_id` must be persisted (not null) — otherwise `skipped_no_provider_id`
2. Row must still belong to the requesting org (no cross-org tampering)
3. `verifyInboxExists()` must return `{ exists: true }` — otherwise `skipped_verify_failed`
4. Provider-returned email must match the DB record
5. Provider-returned `inbox_id` must match the stored `provider_inbox_id`

Test 13 verifies the `provider_inbox_id` gate. Test 14 verifies the verification call is made.

### 9 ✅ Provisioning idempotency (`agentmail-ownership-service.ts`, `agentmail-service.ts`)

**Before:** Inbox creation had no idempotency mechanism at the provider level.

**After:** `createOrVerifyInbox(localPart, clientId?)` accepts an optional `clientId`. `provisionOrgInboxes()` passes `te-{orgId}-{role}` as the `client_id` parameter — the provider returns the existing inbox instead of creating a duplicate when called twice with the same `client_id` (verified from docs).

**Reconciliation path:** If a DB row exists with a `null` provider_inbox_id (crashed mid-provision), `provisionOrgInboxes` re-fetches from the provider using `client_id` and updates the row in-place (`status: "reconciled"`).

### 10 ✅ Role parameter semantics (`agentmail-ownership-service.ts`)

**Before:** `provisionOrgInboxes` and `activateOrgInboxes` accepted `roles?: AgentMailRole[]` but didn't validate the values.

**After:** `validateRoles()` throws immediately with a descriptive error listing the unknown role names. Valid roles are defined by the `AGENT_ROLES` constant. Test 17 verifies this behavior.

### 11 ✅ Crash recovery (`agentmail-inbound-router.ts`, `agentmail-migration.ts`)

**Before:** `ON CONFLICT (provider_message_id) DO NOTHING` — any in-flight crash permanently suppressed retries.

**After:** Full `received → processing → completed | failed` state machine:

```
Constants:  STALE_LEASE_MS = 5 minutes, MAX_ATTEMPTS = 3

On each delivery:
  INSERT ... ON CONFLICT DO NOTHING RETURNING id, processing_state, processing_attempts

  If new row: proceed to claim
  If conflict:
    processing_state='completed'          → idempotent skip
    processing_state='processing', fresh  → concurrent skip
    processing_state='processing', stale  → reclaim (fall through to claim)
    processing_state='failed', ≥ MAX     → exhausted skip
    processing_state='failed', < MAX     → retry (fall through to claim)
    processing_state='received'          → claim

  Atomic claim: UPDATE ... WHERE processing_state IN (...) RETURNING id
  If claim fails: concurrent skip

  On success: UPDATE SET processing_state='completed'
  On failure: UPDATE SET processing_state='failed', last_error=...
```

Tests 11 (stale lease reclaim), 12 (completed on success), and 24 (max-attempt block) verify the state machine.

### 12 ✅ Test suite (`server/tests/agentmail-provider-contract.test.ts`)

24 new behavioral tests covering all defects. All pass against the live development database.

| # | Test | Result |
|---|------|--------|
| 1 | `isAgentMailSchemaReady()` after migration | ✅ |
| 2 | `handleAgentMailWebhook` accepts verified `message.received` payload | ✅ |
| 3 | Correct `Authorization: Bearer` header accepted | ✅ |
| 4 | Wrong `Authorization` header value rejected | ✅ |
| 5 | Missing `Authorization` header rejected when secret configured | ✅ |
| 6 | `resolveOrgByProviderInboxId` resolves Org C | ✅ |
| 7 | Provider inbox ID / address mismatch → quarantine | ✅ |
| 8 | Disabled inbox via provider inbox ID → inactive_ownership | ✅ |
| 9 | Quarantine row has `organization_id=NULL`, `routing_status='quarantine'` | ✅ |
| 10 | Duplicate delivery → `already_completed` skip | ✅ |
| 11 | Stale processing lease reclaimed by retry | ✅ |
| 12 | `processInboundAgentMail` sets `processing_state='completed'` | ✅ |
| 13 | Activation gate: missing `provider_inbox_id` → skipped | ✅ |
| 14 | Activation gate: verification called before promote | ✅ |
| 15 | `UNIQUE` partial index blocks duplicate `provider_inbox_id` | ✅ |
| 16 | Multiple `NULL` `provider_inbox_id` allowed | ✅ |
| 17 | Unknown role names throw immediately | ✅ |
| 18 | `buildOrgUsername` produces stable, address-safe identifier | ✅ |
| 19 | `AGENT_ROLES` covers exactly six roles | ✅ |
| 20 | Retired inbox via provider inbox ID → inactive_ownership | ✅ |
| 21 | Address-only resolution works without `inbox_id` | ✅ |
| 22 | RFC 2822 formatted addresses normalized correctly | ✅ |
| 23 | Disabled address-only → inactive_ownership | ✅ |
| 24 | Exhausted retry attempts (≥3) → permanent skip | ✅ |

### 13 ✅ Codex compatibility

No changes to `server/beta-wave6-routes.ts`, `server/financial-brain.ts`, or any other protected file.

---

## Files Modified or Created

| File | Type | Summary |
|------|------|---------|
| `server/services/agentmail-migration.ts` | **New** | Deterministic ordered migration; readiness gate |
| `server/services/agentmail-ownership-service.ts` | **Rewrite** | `resolveOrgByProviderInboxId`; `client_id` provisioning; activation gate; role validation; reconciliation |
| `server/services/agentmail-service.ts` | **Updated** | `createOrVerifyInbox` → `inbox_id` + `client_id`; `verifyInboxExists` → `{exists,inboxId,email}`; `handleAgentMailWebhook` → timing-safe header auth |
| `server/agentmail-routes.ts` | **Updated** | Real event shape; readiness gate; quarantine logging; ADMIN-only lifecycle routes |
| `server/services/agentmail-inbound-router.ts` | **Updated** | `providerInboxId`/`providerEventId` on payload; crash-recovery state machine; `processing_state=completed` on success |
| `server/tests/agentmail-provider-contract.test.ts` | **New** | 24 behavioral tests covering all 13 defects |

---

## Production Deployment Instructions

Before enabling AgentMail in production:

1. **Set `AGENTMAIL_WEBHOOK_SECRET`** in Replit Secrets with a long random value.

2. **Create the webhook at AgentMail** with the secret as a custom delivery header:
   ```typescript
   client.webhooks.create({
     url: "https://your-domain.com/api/agentmail/webhook",
     event_types: ["message.received"],
     headers: { "Authorization": `Bearer ${AGENTMAIL_WEBHOOK_SECRET}` },
   });
   ```

3. **Provision inboxes** for each org: `POST /api/agentmail/ownership/provision` (ADMIN token required).

4. **Activate inboxes** after provisioning and provider verification: `POST /api/agentmail/ownership/activate` (ADMIN token required).

The schema migration runs automatically on server startup. No manual DDL is required.
