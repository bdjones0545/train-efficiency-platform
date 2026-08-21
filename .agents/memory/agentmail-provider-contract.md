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

### Webhook authentication — Svix (NOT Bearer token)
- AgentMail uses **Svix** for webhook delivery (ref: agentmail.to/docs/webhook-verification)
- Required headers: `svix-id`, `svix-timestamp`, `svix-signature` (space-delimited `v1,<base64>` list)
- Signed content: `${svix-id}.${svix-timestamp}.${rawBodyUtf8}`
- Signing key: base64-decode of `AGENTMAIL_WEBHOOK_SECRET` after stripping `whsec_` prefix
- Timestamp replay protection: ±5 minutes (matches Svix default)
- **NEVER reconstruct from JSON.stringify(req.body)** — use `req.rawBody` (Buffer from `express.json({ verify })`)
- Missing secret → **503** (not 200, not 401); wrong sig → **401**; no dev bypass exists
- Verification module: `server/services/agentmail-svix.ts` → `verifyAgentMailWebhook(rawBody, headers)`
- Test fixture: `buildTestSvixSignature(secret, msgId, tsSeconds, rawBodyString)` → `"v1,<base64>"` string (4 args, returns string — NOT an object)
- `handleAgentMailWebhook` in agentmail-service.ts is **DEPRECATED** — returns `{ok:false}` always

**Why:** Codex re-verification confirmed Svix from live docs; prior Bearer token auth was wrong. `req.rawBody` is captured at `server/index.ts` line ~147 via `express.json({ verify: (req, res, buf) => { req.rawBody = buf; } })`.

## Key Implementation Rules

### Routing authority — inbox_id is MANDATORY (no address fallback)
- `resolveOrgByProviderInboxId(providerInboxId, toAddress)` is the **only** routing path
- `resolveOrgFromInbox(toAddress)` (address-only) is NOT used in the webhook handler — removed
- Missing `inbox_id` → quarantine immediately (cannot establish tenant identity without it)
- Unknown `inbox_id` → quarantine; quarantine persistence failure → **503** (so provider retries, not 200)
- Quarantine rows: `organization_id = NULL`, `routing_status = 'quarantine'`, `processing_state = 'completed'`
- `persistQuarantine()` helper in agentmail-routes.ts returns `false` on DB error → caller returns 503

### Processing state machine
States: `received → processing → completed | failed`
- `STALE_LEASE_MS = 5 minutes`, `MAX_ATTEMPTS = 3`
- Stale processing lease → reclaimed by retry (crash recovery)
- Failed + attempts ≥ MAX → permanently skipped (`max_processing_attempts`)
- Always mark `processing_state = 'completed'` after successful downstream routing

### Lifecycle auth
- All ownership **mutation** routes (`provision`, `activate`, `disable`, `retire`, `retire-all`) are `requireRole("ADMIN")` ONLY
- Read-only routes (`list`, `verify`) allow COACH+ADMIN

### Activation gate (7 checks — all HARD REQUIRED)
1. `provider_inbox_id` must be persisted (not null)
2. Row must belong to the requesting org
3. `verifyInboxExists()` must return `{ exists: true }`
4. Provider must return an email address (hard required — not optional `if (verification.email &&)`)
5. Provider email must exactly match persisted address (case-insensitive)
6. Provider must return an `inboxId` (hard required — not optional)
7. Provider `inboxId` must exactly equal stored `provider_inbox_id`

**Why:** Codex audit found gates 4-5 were optional (only checked mismatches, not missing values). Gates 6-7 were absent entirely. All 7 gates must be hard-required for activation.

### Downstream idempotency — agentmail_effect_log
- Table: `agentmail_effect_log (id, inbound_id, effect_type, UNIQUE(inbound_id, effect_type))`
- Pattern: `INSERT ON CONFLICT DO NOTHING RETURNING id` — claimed slot means proceed, no row means skip
- Helper: `tryEffect(inboundId, effectType, fn)` in agentmail-inbound-router.ts
- Effect types: `prospect`, `applicant`, `software_task`, `attention_item`, `reply_queue`, `ceo_timeline`
- `createDownstreamRecord(orgId, email, result, inboundId)` — 4th param is now required
- Individual effect failures are non-critical (tryEffect catches and returns false, doesn't propagate)

### Outbound API — correct endpoints
- Send: `POST /v0/inboxes/{providerInboxId}/messages/send` — `to` must be an **array**
- Reply: `POST /v0/inboxes/{providerInboxId}/messages/{messageId}/reply`
- Both require `providerInboxId` from `getActiveOwnershipRow(orgId, role)` — returns `{emailAddress, providerInboxId}`
- `getActiveOwnershipRow` returns `null` when no active row with `provider_inbox_id IS NOT NULL` — fail closed

### Migration: execDDL vs tx.execute
- `execDDL(stmt)` uses global `db.execute` — only safe for tables that ALREADY EXIST in committed DB
- Newly created tables (e.g. `agentmail_effect_log`) need indexes created via `tx.execute(sql`...`)` (template literal, not `sql.raw()`) within the SAME transaction
- `tx.execute(sql.raw(stmt))` does NOT work — Drizzle transaction proxy rejects `sql.raw()` type
- Use template literal `tx.execute(sql`CREATE INDEX...`)` inside the tx for new-table DDL

### Schema constraints
- `UNIQUE` partial index on `provider_inbox_id WHERE provider_inbox_id IS NOT NULL` — multiple NULLs allowed
- `CHECK` on `role IN ('revenue','hiring','scheduling','support','operations','ceo')`
- `CHECK` on `ownership_state IN ('provisioning','active','disabled','retired')`

### Migration ordering
- `agentmail-migration.ts` is the single deterministic migration; do NOT run ad-hoc DDL
- Ordering: inbound table first → ownership table → outbound audit table
- Readiness gate: `isAgentMailSchemaReady()` checked at webhook handler entry; returns 503 while migrating

## Test Files
- `server/tests/agentmail-multitenant.test.ts` — 12 multi-tenant isolation tests
- `server/tests/agentmail-provider-contract.test.ts` — 35 provider contract behavioral tests (tests 2-4 updated for Svix deprecation)
- `server/tests/agentmail-p0-remediation.test.ts` — 51 P0 remediation tests across 12 items (ALL PASSING)
- Combined run: 86 tests, 0 failures

## buildTestSvixSignature call signature
`buildTestSvixSignature(secret: string, msgId: string, tsSeconds: number, rawBody: string): string`
- Returns the `svix-signature` header value string (`"v1,<base64>"`)
- Caller must set `svix-id = msgId`, `svix-timestamp = String(tsSeconds)`, `svix-signature = result`
- Use `Math.floor(Date.now() / 1000)` for current timestamp
