---
name: AgentMail Provider Contract
description: Verified provider API shapes, webhook auth mechanism, and key implementation rules for the AgentMail integration.
---

## Verified Provider Contract (from live docs)

### Event shape
- Dispatch field: `event.event_type` (NOT `event.type`)
- Handled events: `message.received`, `message.received.spam`, `message.received.blocked`, `message.received.unauthenticated`
- Email data lives at `event.message` (NOT `event.email` or `event.data`)
- `message.to` is an **array** of RFC 2822 address strings (NOT a single string)
- `message.inbox_id` is the authoritative provider inbox identity for routing
- `message.message_id` is the SMTP Message-ID — use for DB deduplication
- `message.thread_id` is the thread identifier
- `event.event_id` is the webhook delivery ID

### Inbox creation API
- Response field: `inbox_id` (NOT `id`)
- Idempotency: pass `client_id` parameter on creation — provider returns existing inbox on duplicate
- Convention: `te-{orgId}-{role}` as the `client_id` for per-org inboxes

### Webhook authentication
- AgentMail uses **custom delivery headers** (NOT HMAC signatures, NOT Svix)
- Svix-style signature scheme could NOT be confirmed from official docs (security page 404s)
- Implementation: `Authorization: Bearer <AGENTMAIL_WEBHOOK_SECRET>` custom header
- Configure at AgentMail: `client.webhooks.create({ headers: { "Authorization": "Bearer <secret>" } })`
- Verification: timing-safe comparison via HMAC-of-both-inputs (handles different lengths)
- Production: missing/wrong header → 401. Dev (no secret configured): pass with warning

**Why:** JSON.stringify(req.body) is NOT the raw bytes (do not use for any body signing). The provider's actual mechanism is header-based per the webhooks overview page.

## Key Implementation Rules

### Routing authority
- `resolveOrgByProviderInboxId(providerInboxId, toAddress)` is primary (uses inbox_id as key)
- `resolveOrgFromInbox(toAddress)` is fallback (address-only, no inbox_id in payload)
- If inbox_id and address disagree → `provider_id_mismatch` → quarantine, never resolve
- Quarantine rows: `organization_id = NULL`, `routing_status = 'quarantine'`, `processing_state = 'completed'`

### Processing state machine
States: `received → processing → completed | failed`
- `STALE_LEASE_MS = 5 minutes`, `MAX_ATTEMPTS = 3`
- Stale processing lease → reclaimed by retry (crash recovery)
- Failed + attempts ≥ MAX → permanently skipped (`max_processing_attempts`)
- Always mark `processing_state = 'completed'` after successful downstream routing

### Lifecycle auth
- All ownership **mutation** routes (`provision`, `activate`, `disable`, `retire`, `retire-all`) are `requireRole("ADMIN")` ONLY
- Read-only routes (`list`, `verify`) allow COACH+ADMIN

### Activation gate (5 checks)
1. `provider_inbox_id` must be persisted (not null)
2. Row must belong to the requesting org
3. `verifyInboxExists()` must return `{ exists: true }`
4. Provider email matches DB record
5. Provider `inbox_id` matches stored `provider_inbox_id`

### Schema constraints
- `UNIQUE` partial index on `provider_inbox_id WHERE provider_inbox_id IS NOT NULL` — multiple NULLs allowed
- `CHECK` on `role IN ('revenue','hiring','scheduling','support','operations','ceo')`
- `CHECK` on `ownership_state IN ('provisioning','active','disabled','retired')`

### Migration ordering
- `agentmail-migration.ts` is the single deterministic migration; do NOT run ad-hoc DDL
- Ordering: inbound table first → ownership table → outbound audit table
- Readiness gate: `isAgentMailSchemaReady()` checked at webhook handler entry; returns 503 while migrating

## Test Files
- `server/tests/agentmail-multitenant.test.ts` — 11 multi-tenant isolation tests
- `server/tests/agentmail-provider-contract.test.ts` — 24 provider contract behavioral tests (all 13 defects covered)
