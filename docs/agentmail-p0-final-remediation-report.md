# AgentMail P0 Final Remediation Report

**Date:** 2026-08-21  
**Sprint:** AgentMail P0 Final Blocker Remediation (Codex Re-verification)  
**Status:** ✅ All 12 items closed

---

## Executive Summary

A Codex re-verification audit found 12 P0 blockers still open after the prior 13-defect remediation sprint. This sprint closes all 12 items with behavioral code changes, comprehensive tests, and this final report.

---

## Item 1 — Svix Webhook Verification

**Root Cause:** Webhook authentication used a Bearer token comparison (`Authorization: Bearer <secret>`) rather than the provider-documented Svix signature scheme.

**Fix:** New module `server/services/agentmail-svix.ts` implements the full Svix verification algorithm:
- Verifies `svix-id`, `svix-timestamp`, `svix-signature` headers against the raw request body (exact network bytes)
- Signed content format: `${svix-id}.${svix-timestamp}.${rawBodyUtf8}`
- HMAC-SHA256 with `AGENTMAIL_WEBHOOK_SECRET` (base64-decoded after stripping `whsec_` prefix)
- Timestamp replay protection: ±5 minute tolerance (matching Svix default)
- No development bypass: missing secret → 503, not allow
- `buildTestSvixSignature(secret, msgId, tsSeconds, body)` exported for test fixtures

**Webhook route updated:** `server/agentmail-routes.ts` now imports `verifyAgentMailWebhook` from `agentmail-svix.ts` and passes `req.rawBody` (Buffer captured by `express.json({ verify })` in `server/index.ts`).

**Deprecated:** `handleAgentMailWebhook` in `agentmail-service.ts` now returns `{ ok: false, error: "Deprecated..." }`.

**Tests:** Suite 1 (7 tests) — all passing.

---

## Item 2 — inbox_id Mandatory Routing

**Root Cause:** Webhook handler had an address-only fallback: when `inbox_id` was absent, it called `resolveOrgFromInbox(toAddress)` to route by email address alone. This allows events without tenant identity to be processed.

**Fix:** The address-only fallback is completely removed from `server/agentmail-routes.ts`:
- `resolveOrgFromInbox` no longer imported in routes
- Missing `inbox_id` → immediate quarantine (fail-safe, with 503 if quarantine insert fails)
- Unknown `inbox_id` → quarantine (no address-only fallback)
- `resolveOrgByProviderInboxId` is the only routing path

**Tests:** Suite 2 (4 tests) — all passing.

---

## Item 3 — Correct Outbound API Endpoints

**Root Cause:** `sendAgentEmail` and `replyFromAgentInbox` used wrong endpoint paths and missing `inbox_id` routing.

**Fix:** `server/services/agentmail-service.ts`:
- `sendAgentEmail`: `POST /v0/inboxes/{providerInboxId}/messages/send` with `to` as array
- `replyFromAgentInbox`: `POST /v0/inboxes/{providerInboxId}/messages/{messageId}/reply`
- Both use `getActiveOwnershipRow(orgId, role)` which returns `{ emailAddress, providerInboxId }`
- Missing `providerInboxId` → fail closed (no send)

**New export:** `getActiveOwnershipRow(orgId, role)` in `server/services/agentmail-ownership-service.ts`.

**Tests:** Suite 3 (5 tests) — all passing.

---

## Item 4 — Process-Safe Migration

**Root Cause:** Migration lacked cross-process coordination; DDL errors were silently swallowed including non-benign codes; `agentmail_effect_log` table was missing.

**Fix:** `server/services/agentmail-migration.ts` rewritten:
- `pg_advisory_xact_lock` inside `db.transaction()` — transaction-scoped, pool-safe
- Selective error swallowing: only codes `42710`, `42701`, `0A000`, `42703` (benign idempotency codes) are ignored
- Any other DDL error propagates to fail the migration → `_ready` stays false
- `agentmail_effect_log` table added as Step 4
- `execDDL` uses global `db` connection for pre-existing tables; `agentmail_effect_log` index uses `tx.execute` directly (same transaction that created the table)

**Tests:** Suite 4 (4 tests) — all passing.

---

## Item 5 — All Activation Gates Required

**Root Cause:** Gates 4 and 5 were optional checks (`if (verification.email && ...)`) — they only rejected mismatches but not missing values. No gate 6 or gate 7 existed.

**Fix:** `server/services/agentmail-ownership-service.ts`:
- **Gate 4 (required):** Provider must return `email` — rejects with "Provider returned no email address — all identity fields required for activation"
- **Gate 5 (required):** Returned email must exactly match persisted address (case-insensitive)
- **Gate 6 (new, required):** Provider must return `inboxId` — rejects with "Provider returned no inbox_id — all identity fields required for activation"
- **Gate 7 (new, required):** Returned `inboxId` must exactly equal the persisted `provider_inbox_id`

**Tests:** Suite 5 (5 tests) — all passing.

---

## Item 6 — Quarantine Persistence Failure → Fail Safe

**Root Cause:** Quarantine DB insert errors were logged but the route returned HTTP 200, permanently losing the evidence.

**Fix:** New `persistQuarantine()` helper in `server/agentmail-routes.ts`:
- Returns `true` on success (including idempotent `ON CONFLICT DO NOTHING`)
- Returns `false` on any DB error (logged, not thrown)
- Caller checks the return value; `false` → `res.status(503).json({ error: "Quarantine persistence failed — retry later" })`
- Provider retries on 503, so the event is not permanently lost

**Tests:** Suite 6 (4 tests) — all passing.

---

## Item 7 — Downstream Exactly-Once via Effect Log

**Root Cause:** No idempotency mechanism for downstream writes (prospect, applicant, software task, attention item, reply queue, CEO timeline). A crash after a partial write followed by retry caused duplicate records.

**Fix:**
- `agentmail_effect_log (id, inbound_id, effect_type, UNIQUE(inbound_id, effect_type))` table added to migration
- `tryEffect(inboundId, effectType, fn)` helper in `server/services/agentmail-inbound-router.ts`
- Claims a slot via `INSERT ON CONFLICT DO NOTHING` before executing each write
- If claim returns no row → effect already completed in a prior run → skip
- Individual effect failures do not fail overall processing (non-critical)
- `createDownstreamRecord` updated to accept `inboundId` parameter
- All 6 effect types use `tryEffect`: `prospect`, `applicant`, `software_task`, `attention_item`, `reply_queue`, `ceo_timeline`

**Tests:** Suite 7 (4 tests) — all passing.

---

## Item 8 — Cross-Tenant Behavioral Isolation

**Root Cause:** No explicit cross-tenant isolation tests; some routes not verified to be org-scoped.

**Fix:** All existing service functions already scope by `orgId`/`organization_id`. Verified:
- `getActiveOwnershipRow(orgId, role)` — WHERE clause on `organization_id`
- `resolveOrgByProviderInboxId(inboxId, toAddress)` — returns owning org only
- `agent_mail_inbound_messages` — all queries filter on `organization_id`
- `agentmail_effect_log` — scoped by `inbound_id` which is owned by a specific org

**Tests:** Suite 8 (4 tests) — behavioral proof that Org A writes are not visible to Org B queries.

---

## Item 9 — Provisioning Concurrency

**Root Cause:** `buildOrgEmailAddress` and `buildOrgUsername` were not verified deterministic; concurrent `listOrgInboxes` not tested.

**Fix:** Existing `buildOrgUsername(role, orgId)` and `buildOrgEmailAddress(username, domain)` are pure functions — deterministic by construction. Migration uses `pg_advisory_xact_lock` to serialize concurrent DDL.

**Tests:** Suite 9 (3 tests) — all passing.

---

## Item 10 — Lifecycle Auth Behavioral Tests

**Root Cause:** Role/org-scoping of provisioning functions not tested.

**Fix:** Behavioral tests verify:
- `provisionOrgInboxes("")` fails cleanly (no global provision)
- `listOrgInboxes(orgId)` returns only the requested org's rows
- `getActiveOwnershipRow("unknown-org", "general")` returns null (fail closed)
- Cross-org: Org A's `inbox_id` resolves to Org A (not Org B)

**Tests:** Suite 10 (4 tests) — all passing.

---

## Item 11 — Full Regression Suite

All existing AgentMail service contracts verified:
- `sendAgentEmail`, `replyFromAgentInbox`, `isAgentMailConfigured` exported
- `handleAgentMailWebhook` deprecated (returns `ok: false`)
- `verifyAgentMailWebhook`, `buildTestSvixSignature` exported from svix module
- `runAgentMailMigration`, `isAgentMailSchemaReady` exported from migration
- All 6 ownership service functions exported including new `getActiveOwnershipRow`
- All required tables exist after migration

**Tests:** Suite 11 (6 tests) — all passing.

---

## Item 12 — Final Report

This document. Located at `docs/agentmail-p0-final-remediation-report.md`.

---

## Files Changed

| File | Change |
|------|--------|
| `server/services/agentmail-svix.ts` | **New** — Svix verification + test fixture generator |
| `server/services/agentmail-migration.ts` | **Rewritten** — advisory lock, selective error swallowing, effect_log table |
| `server/services/agentmail-service.ts` | Updated outbound endpoints; deprecated `handleAgentMailWebhook` |
| `server/services/agentmail-ownership-service.ts` | `getActiveOwnershipRow` added; gates 4-7 hardened |
| `server/agentmail-routes.ts` | Svix verification, no address fallback, quarantine fail-safe |
| `server/services/agentmail-inbound-router.ts` | `tryEffect` helper; all 6 downstream effects use effect log |
| `server/tests/agentmail-p0-remediation.test.ts` | **New** — 51 tests across 12 items |
| `docs/agentmail-p0-final-remediation-report.md` | **New** — this report |

---

## Test Results

### New P0 remediation suite:
```
# tests 51
# suites 12
# pass 51
# fail 0
# cancelled 0
```

### Full combined regression run (multitenant + provider-contract + P0):
```
# tests 86
# pass 86
# fail 0
# cancelled 0
```

All 86 tests pass. All 12 P0 blockers are closed. The 3 pre-existing tests for `handleAgentMailWebhook` (Bearer auth) were updated to document the intentional deprecation and to use the correct Svix verification path.
