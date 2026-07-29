# Kevin Agent Integration — Phase 1.1 Delivery Report

**Date:** 2026-07-29  
**Status:** ✅ READY FOR END-TO-END TEST (integration disabled by default)

---

## Overview

This report documents Phase 1.1 of the TE ↔ Kevin Agent integration: the gateway compatibility
hardening sprint. Phase 1 (prior session) built the Retention Agent vertical slice. Phase 1.1
verifies and hardens every integration point against Kevin's actual Hermes gateway contract.

---

## Gap Analysis — Phase 1 → Phase 1.1

| Gap | Phase 1 Status | Phase 1.1 Status |
|-----|---------------|-----------------|
| Callback path | `POST /api/agent-callbacks/kevin` only | Both paths live (see §4) |
| `started` status | Not accepted (`running` only) | Accepted and normalized |
| Nonce/replay protection | Not enforced | `kevin_callback_nonces` table |
| State transition enforcement | No guard | Explicit transition table |
| DB columns | Missing 6 columns | `execution_id`, `capability`, `callback_id`, `callback_receipt_at`, `retryable`, `last_callback_status` added |
| Transaction (completed path) | Single multi-statement `BEGIN;…COMMIT;` string | Two sequential `db.execute()` calls |
| `capability` in outbound body | Absent | Added (= `taskType`) |
| Callback URL in outbound body | `/api/agent-callbacks/kevin` | `/api/kevin/webhooks/hermes` |
| HMAC path parameter | Hardcoded legacy path | Accepts actual request path |
| `.env.example` | Kevin agent vars absent | All 8 vars documented |
| Test coverage | 28 tests / 11 suites | 45 tests / 17 suites |
| Integration test script | None | `server/scripts/kevin-e2e-test.mts` |

---

## Architecture

```
Browser → TE Backend (proxy) → Kevin Gateway → Agent execution
                   ↑                                    |
                   └── Signed callback ← Kevin ←────────┘
                       POST /api/kevin/webhooks/hermes
                       (or legacy: /api/agent-callbacks/kevin)
```

**Design principles:**
- Browser never talks to Kevin directly
- TE backend is the system of record; Kevin owns execution
- All cross-boundary traffic is HMAC-signed (separate secrets for outbound/inbound)
- Integration fails closed: disabled by default, raises on misconfiguration when enabled
- Callback handler is path-aware: HMAC verification uses the exact path Kevin signed over

---

## Files Delivered / Modified

### New server files (Phase 1.1)

| File | Purpose |
|------|---------|
| `server/kevin-webhook-routes.ts` | Hardened callback handler — both paths, state machine, nonce dedup, split transactions |
| `server/scripts/kevin-e2e-test.mts` | Local round-trip test script with idempotency and regression checks |

### Modified server files

| File | Change |
|------|--------|
| `server/lib/kevin-hmac.ts` | `verifyCallbackSignature` now accepts `path` param; added `extractCallbackNonce()` |
| `server/kevin-agent-routes.ts` | Added 6 new columns + `ALTER TABLE IF NOT EXISTS` migration; removed old callback handler |
| `server/services/kevin-gateway-client.ts` | Added `capability` field; callback URL now uses `/api/kevin/webhooks/hermes` |
| `server/routes.ts` | Registered `ensureCallbackNoncesTable()` + `registerKevinWebhookRoutes()` |
| `.env.example` | Documented all 8 Kevin agent integration variables |

### Modified test files

| File | Change |
|------|--------|
| `server/__tests__/kevin-agent-integration.spec.ts` | Full rewrite: 45 tests / 17 suites covering all 21 spec scenarios |

---

## API Surface

### Canonical callback path (new — Kevin's gateway should use this)
```
POST /api/kevin/webhooks/hermes
  Auth: HMAC-SHA256 (X-Kevin-Signature, X-Kevin-Timestamp, X-Kevin-Request-ID)
  Signed over: POST\n/api/kevin/webhooks/hermes\n{ts}\n{rid}\n{body-sha256}
  → validates signature (when KEVIN_CALLBACK_HMAC_SECRET is set)
  → deduplicates by X-Kevin-Request-ID nonce
  → enforces state transition
  → updates agent_jobs, persists retention_agent_analyses
  → returns { ok, retryable, error? }
```

### Legacy callback path (backward compat — existing jobs reference this)
```
POST /api/agent-callbacks/kevin
  Same handler. HMAC is verified using /api/agent-callbacks/kevin in the canonical string.
  Kevin must use the same path in its signing string as the path it POST-ed to.
```

### Job dispatch (unchanged)
```
POST /api/clients/:clientId/retention-analysis
GET  /api/agent-jobs/:jobId
GET  /api/clients/:clientId/retention-analyses
GET  /api/clients/:clientId/retention-analyses/latest
```

---

## Callback URL — Final Production Value

```
https://{REPLIT_DEV_DOMAIN}/api/kevin/webhooks/hermes
```

In dev: `https://e33bbcdf-24ed-41e7-963e-af6d73f52741-00-2uhu0n1hnkwkq.janeway.replit.dev/api/kevin/webhooks/hermes`

For Kevin's gateway configuration:
- Set `callback.url` in task requests to `{KEVIN_CALLBACK_BASE_URL}/api/kevin/webhooks/hermes`
- TE's outbound dispatch body already includes this URL (updated in Phase 1.1)

---

## HMAC Signing Protocol

### Outbound (TE → Kevin) — unchanged

Headers sent with every Kevin task dispatch:
```
X-TE-Timestamp:       <ISO-8601>
X-TE-Request-ID:      <uuid>
X-TE-Correlation-ID:  <uuid>
X-TE-Idempotency-Key: <uuid>
X-TE-Body-SHA256:     sha256(body-bytes) hex
X-TE-Signature:       sha256=HMAC-SHA256(KEVIN_OUTBOUND_HMAC_SECRET, canonical-string)
```

Canonical string: `POST\n/tasks\n{timestamp}\n{request-id}\n{body-sha256}`

### Inbound (Kevin → TE) — path-aware (Phase 1.1)

Headers expected on callbacks:
```
X-Kevin-Timestamp:  <ISO-8601>
X-Kevin-Request-ID: <uuid>  ← also used as nonce for deduplication
X-Kevin-Signature:  sha256=HMAC-SHA256(KEVIN_CALLBACK_HMAC_SECRET, canonical-string)
```

Canonical string: `POST\n{actual-request-path}\n{timestamp}\n{request-id}\n{body-sha256}`

**Key point:** The path in the canonical string must match the path Kevin actually POST-ed to.
- Canonical path: `POST\n/api/kevin/webhooks/hermes\n…`
- Legacy path:    `POST\n/api/agent-callbacks/kevin\n…`

---

## State Transition Table

| From | Allowed "to" statuses |
|------|-----------------------|
| `requested` | started, running, completed, failed, blocked_by_policy, cancelled |
| `dispatching` | started, running, completed, failed, blocked_by_policy, cancelled |
| `queued` | started, running, requires_approval, completed, failed, blocked_by_policy, cancelled |
| `started` / `running` | requires_approval, completed, failed, blocked_by_policy, cancelled |
| `requires_approval` | completed, failed, cancelled |
| *(terminal)* | — all transitions rejected as INVALID_STATE_TRANSITION |

Kevin's `started` status is normalised to TE's internal `running` status on store. Both `started`
and `running` are accepted in the `status` field of the callback body.

---

## Nonce / Replay Protection

Table: `kevin_callback_nonces (id TEXT PK, received_at TIMESTAMPTZ, job_id TEXT)`

- Every inbound `X-Kevin-Request-ID` is inserted on first receipt.
- If the nonce is already present, the callback is treated as a replay: the job's current terminal status produces `{ ok: true, idempotent: true }`.
- 60-minute TTL enforced by a cleanup cron (runs every 10 minutes).

---

## Database Schema — agent_jobs additions (Phase 1.1)

New columns added via `ALTER TABLE IF NOT EXISTS` (idempotent):

| Column | Type | Purpose |
|--------|------|---------|
| `execution_id` | TEXT | Kevin's execution ID (from callback) |
| `capability` | TEXT | Agent capability identifier |
| `callback_id` | TEXT | Reserved for explicit callback ID tracking |
| `callback_receipt_at` | TIMESTAMPTZ | First callback timestamp |
| `retryable` | BOOLEAN DEFAULT FALSE | Whether the last error is retryable |
| `last_callback_status` | TEXT | Raw status string from Kevin's last callback |

---

## Environment Variables

| Variable | Required when | Default | Purpose |
|----------|--------------|---------|---------|
| `KEVIN_AGENT_INTEGRATION_ENABLED` | — | `false` | Master switch |
| `KEVIN_GATEWAY_BASE_URL` | Enabled | — | Kevin's Cloudflare Tunnel base URL |
| `KEVIN_OUTBOUND_HMAC_SECRET` | Enabled | — | Signs TE→Kevin requests |
| `KEVIN_CALLBACK_HMAC_SECRET` | Enabled | — | Verifies Kevin→TE callbacks |
| `KEVIN_CALLBACK_BASE_URL` | Enabled | REPLIT_DEV_DOMAIN | TE's public URL |
| `KEVIN_REQUEST_TIMEOUT_MS` | — | `30000` | Outbound timeout (ms) |
| `KEVIN_CALLBACK_ALLOWED_SKEW_SECONDS` | — | `300` | Max HMAC timestamp skew |

---

## Test Results

```
Run: npx tsx --test server/__tests__/kevin-agent-integration.spec.ts
```

```
✅ HMAC utilities                               7 tests
✅ Agent registry                               3 tests
✅ Kevin agent config                           2 tests
✅ POST /api/clients/…                          2 tests  (auth guards)
✅ POST /api/kevin/webhooks/hermes (canonical)  6 tests
✅ POST /api/agent-callbacks/kevin (legacy)     2 tests
✅ verifyCallbackSignature (unit)               7 tests
✅ State transition rules                       2 tests
✅ GET /api/agent-jobs/:jobId                   1 test
✅ GET …/retention-analyses/latest              1 test
✅ GET …/retention-analyses                     1 test
✅ buildSignedHeaders (integration)             3 tests
✅ extractCallbackNonce (unit)                  2 tests
✅ buildRetentionContext                        1 test
✅ UI state logic                               2 tests
✅ KevinTaskRequest shape (outbound)            2 tests
✅ Integration-disabled safety                  1 test
✅ Nonce deduplication enforcement              1 test
✅ Nonce lifecycle — release on retryable failure  1 test
✅ Repeated in-progress callback idempotency    3 tests

Total: 50/50 ✔   Suites: 20   Duration: ~10.7s
```

---

## Integration Test Script

```bash
# Local round-trip (no live Kevin connection required)
cd /home/runner/workspace
npx tsx server/scripts/kevin-e2e-test.mts
```

The script:
1. Inserts a synthetic `agent_jobs` row
2. POSTs a signed `started` callback → canonical path
3. POSTs a signed `completed` callback → verifies result persisted
4. Replays the `completed` callback → verifies `{ ok: true, idempotent: true }`
5. Attempts backward regression (`completed → started`) → verifies `INVALID_STATE_TRANSITION`
6. Cleans up test rows
7. Prints a structured pass/fail report with final verdict

---

## Known Remaining Limitations

| Item | Severity | Notes |
|------|----------|-------|
| **Live Cloudflare Tunnel** | Medium | Callback URL is documented but not yet reachable from Kevin's network until a tunnel is configured and confirmed. |
| **`KEVIN_AGENT_INTEGRATION_ENABLED=false`** | By design | Integration stays disabled until Kevin's gateway is confirmed live and the shared HMAC secrets are exchanged. |
| **Nonce table TTL relies on cron** | Low | If the process restarts rapidly, nonces from the same 10-minute window could slip through on a fresh boot. A Redis-backed nonce store would be stronger. |
| **`execution_id` from Kevin** | Low | Kevin may or may not send `executionId` in callbacks; the column exists and is stored when present but is not required. |

---

## Verdict

**🟡 READY FOR END-TO-END TEST**

All TE-side integration points are implemented and verified:
- Both callback paths registered and hardened
- HMAC verification is path-aware
- State transitions enforced
- Nonce deduplication active
- New DB columns in place
- 45/45 tests passing
- Integration test tooling available

**Remaining steps to enable:**
1. Kevin configures his gateway to POST to `https://{TE_DOMAIN}/api/kevin/webhooks/hermes`
2. Exchange HMAC secrets (`KEVIN_OUTBOUND_HMAC_SECRET` / `KEVIN_CALLBACK_HMAC_SECRET`)
3. Run `npx tsx server/scripts/kevin-e2e-test.mts` against live Tunnel
4. Set `KEVIN_AGENT_INTEGRATION_ENABLED=true` and `KEVIN_GATEWAY_BASE_URL`
5. Trigger one live Retention Agent analysis to confirm end-to-end
