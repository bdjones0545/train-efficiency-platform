# AgentMail Multi-Tenant Implementation Report

**Date:** 2026-08-21  
**Status:** ✅ Implementation complete — 11/11 tests passing  
**Production boundary:** No production schema mutations, inbox creations, or routing cutover have been performed. This report is the required deliverable before any production changes.

---

## Summary of Changes

Three existing files were edited and three new files were created to implement per-org inbox ownership with fail-closed routing.

### New Files

| File | Purpose |
|------|---------|
| `server/services/agentmail-ownership-service.ts` | Authoritative ownership module — `resolveOrgFromInbox()`, `getActiveOutboundAddress()`, lifecycle management |
| `server/scripts/provision-agentmail-inboxes.ts` | Idempotent CLI provisioning script with `--verify`, `--activate`, `--dry-run` flags |
| `server/tests/agentmail-multitenant.test.ts` | 11-scenario regression suite |

### Edited Files

#### `server/services/agentmail-inbound-router.ts`
- `resolveOrgFromInbox()` — now delegates to `agentmail-ownership-service.ts` (DB exact-match lookup); old `SELECT id FROM organizations LIMIT 1` removed
- `processInboundAgentMail()` — old pre-check `SELECT ... WHERE provider_message_id` removed; INSERT now uses `ON CONFLICT (provider_message_id) DO NOTHING RETURNING id` with atomic duplicate handling; three new columns added: `routing_status`, `routing_reason`, `routed_at`

#### `server/services/agentmail-service.ts`
- `sendAgentEmail()` — ownership check now runs **before** the send guard; missing active ownership → fail closed with `{ ok: false, error: "AgentMail inbox not provisioned for this organization", blocked: true }` before policy is evaluated
- `replyFromAgentInbox()` — same ordering fix applied
- `verifyInboxExists(emailAddress)` added — provider-level inbox verification without creation
- `createOrVerifyInbox()` — accepts full org-specific username (e.g. `revenue-fef2c242...@domain`)

#### `server/agentmail-routes.ts`
- Imports updated: `resolveOrgFromInbox` now imported from `agentmail-ownership-service` directly; ownership lifecycle functions imported
- `ensureAgentMailTables()` now calls `ensureOwnershipTable()` first, before the inbound-messages DDL
- Webhook quarantine path replaced: uses `resolveOrgFromInbox` full result (orgId + role + reason); quarantine records written with `organization_id = NULL`, `routing_status`, `routing_reason`, `routed_at`; idempotent via `ON CONFLICT (provider_message_id) DO NOTHING`
- Seven new provisioning/lifecycle routes added:
  - `GET /api/agentmail/ownership` — list org's inboxes
  - `POST /api/agentmail/ownership/provision` — register inbox rows in DB
  - `POST /api/agentmail/ownership/activate` — mark provisioned → active
  - `POST /api/agentmail/ownership/verify` — check provider + DB alignment
  - `POST /api/agentmail/ownership/disable/:role` — soft-disable one role
  - `POST /api/agentmail/ownership/retire/:role` — permanently retire one role
  - `POST /api/agentmail/ownership/retire-all` — retire all org inboxes

---

## Architecture Decisions Implemented

| Decision | Implementation |
|----------|---------------|
| Per-org unique role inboxes | `{role}-{orgId_no_hyphens}@domain` (full 32-char hex UUID) |
| Authoritative ownership table | `org_agentmail_inboxes` — UNIQUE on `(organization_id, role)`, `email_address`, `username` |
| Lifecycle states | `provisioning → active → disabled → retired`; only `active` routes traffic |
| Quarantine = `organization_id = NULL` | Three new columns: `routing_status`, `routing_reason`, `routed_at` |
| Quarantined events create no downstream state | Quarantine path returns before `processInboundAgentMail` is called |
| `resolveOrgFromInbox()` = exact-match DB lookup | Zero fallback; non-active match → fail closed |
| Webhook-supplied org IDs never trusted | Routing authority is the address→ownership table only |
| Atomic idempotency | `ON CONFLICT (provider_message_id) DO NOTHING RETURNING id` |
| `sendAgentEmail` / `replyFromAgentInbox` fail closed | Ownership check runs before send guard; missing active ownership → immediate return, no policy evaluation |

---

## Test Results

```
✔ 1 — Org A inbox resolves to Org A
✔ 2 — Org B inbox resolves to Org B
✔ 3 — Org A inbound cannot write Org B downstream records
✔ 4 — Unknown inbox address quarantines (no downstream records)
✔ 5 — DB UNIQUE constraint prevents two orgs sharing an address
✔ 6 — Legacy global inbox address quarantines
✔ 7 — Webhook org ID in payload is ignored; routing uses address lookup
✔ 8 — Duplicate provider event is idempotent (ON CONFLICT DO NOTHING)
✔ 9 — Disabled inbox ownership quarantines inbound mail
✔ 10 — sendAgentEmail fails closed when no active ownership record exists
✔ 11 — Retiring Org A inboxes does not affect Org B resolution

tests: 11 | pass: 11 | fail: 0
```

---

## Production Migration Sequence

> ⚠️ Execute in this exact order. Do NOT skip the verify step before cutover.

### Phase 1 — Schema migration (zero-traffic impact)

```sql
-- Step 1: Create ownership table (idempotent)
-- Runs automatically on next server start via ensureOwnershipTable()

-- Step 2: Add routing columns to inbound messages table (idempotent ALTERs)
-- Also runs automatically on next server start via ensureAgentMailTables()
-- Columns: routing_status TEXT, routing_reason TEXT, routed_at TIMESTAMPTZ
-- organization_id is made nullable (was previously TEXT NOT NULL 'unresolved')
```

Both DDL changes are run automatically by `ensureOwnershipTable()` and `ensureAgentMailTables()` on the next server boot. No manual SQL required.

### Phase 2 — Provision inboxes per org (no traffic change yet)

Run for each org that should have AgentMail:

```bash
# Dry-run first — shows what would be created
npx tsx server/scripts/provision-agentmail-inboxes.ts \
  --org-id <orgId> \
  --dry-run

# Provision (creates DB rows in 'provisioning' state, creates provider inboxes)
npx tsx server/scripts/provision-agentmail-inboxes.ts \
  --org-id <orgId>

# Verify provider + DB are aligned
npx tsx server/scripts/provision-agentmail-inboxes.ts \
  --org-id <orgId> \
  --verify
```

Or via the admin API (authenticated as COACH/ADMIN):

```
POST /api/agentmail/ownership/provision   { orgId }
POST /api/agentmail/ownership/verify      { orgId }
GET  /api/agentmail/ownership             (lists current state)
```

### Phase 3 — Activate (routing cutover)

Only after Phase 2 verify passes with all inboxes confirmed at the provider:

```bash
npx tsx server/scripts/provision-agentmail-inboxes.ts \
  --org-id <orgId> \
  --activate
```

Or via API: `POST /api/agentmail/ownership/activate`

After activation, incoming webhooks to `{role}-{orgId}@domain` resolve to the correct org. Unregistered addresses quarantine with `routing_status = 'no_ownership_record'`.

### Phase 4 — Validate cutover

```bash
# Trigger a simulate-inbound call to each org's addresses
POST /api/agentmail/simulate-inbound  { testCaseIndex: 0 }

# Check quarantine count is zero for active addresses
GET /api/agentmail/ownership
```

### Rollback

If routing behaves incorrectly after activation:

```bash
# Disable all inboxes for an org (reverts to quarantine-all for that org)
POST /api/agentmail/ownership/retire-all   { orgId }
```

This immediately causes all incoming mail to that org's addresses to quarantine without creating downstream records. No schema rollback required — the DB rows remain for audit.

---

## Remaining Decisions / Open Items

| Item | Decision needed |
|------|----------------|
| **Which orgs to provision first** | Recommend starting with `fef2c242` (Bryan's primary org) as the pilot |
| **Legacy global inboxes** (`revenue@domain`, `operations@domain`) | These now quarantine by design (Scenario 6 confirms this). If legacy addresses are still receiving real traffic, provision org-specific addresses first, then update the AgentMail webhook provider config to route to `{role}-{orgId}@domain`. |
| **AgentMail API key for provider inbox creation** | `AGENTMAIL_API_KEY` must be set and valid before running Phase 2. The script checks for this. |
| **Per-org vs shared domain** | Currently all orgs share `agentmail.to` (or whatever `orgDomain` is set to). If provider supports per-org custom domains in the future, update `getAgentMailDomain()` in ownership-service. |

---

## What Was NOT Changed

- No production schema mutations have been applied
- No provider inboxes have been created
- No routing cutover has occurred
- All backend agents (Gmail agent, CEO Heartbeat, etc.) are untouched
- All existing AgentMail send paths still function (just fail-closed for unprovisioned orgs)
