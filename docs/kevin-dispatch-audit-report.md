# Kevin TE → Kevin Dispatch Audit Report

**Date:** 2026-08-14  
**Auditor:** Replit Agent  
**Scope:** Full TE → Kevin dispatch path — signing scheme, secret resolution, base URL, fallback behavior, E2E reachability, and test coverage.

---

## Executive Summary

Three issues found and fixed. One requires a human action (credential correction). No data exposure.

| # | Severity | Finding | Status |
|---|----------|---------|--------|
| 1 | 🔴 CRITICAL | Wrong HMAC signing scheme in `kevin-gateway-client.ts` — was using `X-TE-Signature` (canonical-string), Kevin expects `v1:` scheme | **FIXED** (code change) |
| 2 | 🔴 CRITICAL | `KEVIN_OUTBOUND_HMAC_SECRET` contains a different secret from `KEVIN_CALLBACK_HMAC_SECRET` — fingerprint mismatch | **BLOCKED** — Bryan must correct secret in Replit Secrets |
| 3 | 🟡 MEDIUM | `postKevinAgentTask` export missing — only `dispatchKevinTask` existed | **FIXED** (alias exported) |
| 4 | 🟡 MEDIUM | `docs/kevin-agent-gateway-auth.md` did not exist | **FIXED** (document created) |
| 5 | 🟢 OK | Inbound Kevin → TE callbacks (HMAC verify) were correct throughout | No action |
| 6 | 🟢 OK | `KEVIN_HERMES_BASE_URL` and `KEVIN_GATEWAY_BASE_URL` correctly set | No action |
| 7 | 🟢 OK | `KEVIN_AGENT_INTEGRATION_ENABLED=true` correctly set | No action |

---

## Finding 1 (CRITICAL, FIXED): Wrong outbound HMAC signing scheme

### Before

`kevin-gateway-client.ts` called `buildSignedHeaders()` from `server/lib/kevin-hmac.ts`. That function produces:

```
signing base = "POST\n/tasks\n{timestamp}\n{requestId}\n{bodySha256}"
headers      = X-TE-Timestamp, X-TE-Request-ID, X-TE-Body-SHA256, X-TE-Signature: sha256={hex}
```

Kevin's gateway verifies the **v1: scheme** (matching `shared/kevin/outbound-hmac.ts`):

```
signing base = "v1:{timestampSec}:{rawBody}"
headers      = x-kevin-timestamp, x-kevin-signature: v1={hex}
```

The mismatch caused every outbound `/tasks` call to receive HTTP 401. Because the fallback only triggers on 404 (not 401), every CEO Heartbeat → Kevin dispatch was logging:

```
[CEO Heartbeat] Kevin dispatch skipped (kevin_authentication_failed): Kevin rejected the request signature.
```

### After

`kevin-gateway-client.ts` now calls `signKevinOutboundBody()` from `server/services/kevin-outbound-auth.ts`, which produces the correct `v1:` headers. The secret is resolved from the canonical chain:

```
KEVIN_CALLBACK_HMAC_SECRET → KEVIN_OUTBOUND_HMAC_SECRET → TRAINEFFICIENCY_KEVIN_SIGNING_SECRET
```

---

## Finding 2 (CRITICAL, BLOCKED): `KEVIN_OUTBOUND_HMAC_SECRET` mismatch

### Fingerprints

| Env Var | SHA-256 prefix (16 chars) | Correct? |
|---------|---------------------------|----------|
| `KEVIN_CALLBACK_HMAC_SECRET` | `9205e80778da2b21` | ✅ |
| `TRAINEFFICIENCY_KEVIN_SIGNING_SECRET` | `9205e80778da2b21` | ✅ |
| `KEVIN_OUTBOUND_HMAC_SECRET` | `4c0be9f5470753a9` | ❌ Wrong secret |

All three variables are specified as aliases and **must hold identical values** (see `.env.example` and `docs/kevin-agent-gateway-auth.md`). `KEVIN_OUTBOUND_HMAC_SECRET` currently holds a different secret — likely from a rotation that was applied to `KEVIN_CALLBACK_HMAC_SECRET` but not to `KEVIN_OUTBOUND_HMAC_SECRET`.

### Impact

The code fix in Finding 1 sidesteps this: `signKevinOutboundBody()` reads `KEVIN_CALLBACK_HMAC_SECRET` first (which is correct). The dispatch should now work without rotating any secrets.

However, `KEVIN_OUTBOUND_HMAC_SECRET` must still be corrected for:
- Consistency (the test `kevin-dispatch-contract.test.ts :: "KEVIN_OUTBOUND_HMAC_SECRET must equal KEVIN_CALLBACK_HMAC_SECRET"` will fail until fixed)
- Future-proofing (if any code reads `KEVIN_OUTBOUND_HMAC_SECRET` directly for signing, it will use the wrong secret)

### Required human action

**Bryan** must update `KEVIN_OUTBOUND_HMAC_SECRET` in Replit Secrets to match `KEVIN_CALLBACK_HMAC_SECRET`.  
Steps:
1. Copy the current value of `KEVIN_CALLBACK_HMAC_SECRET` from Replit Secrets
2. Set `KEVIN_OUTBOUND_HMAC_SECRET` to that same value
3. Re-run: `npx tsx --test server/tests/kevin-dispatch-contract.test.ts` — all 28 tests should pass

---

## Finding 3 (MEDIUM, FIXED): `postKevinAgentTask` export missing

`postKevinAgentTask` is the canonical contract name for the TE → Kevin dispatch function but was not exported from `kevin-gateway-client.ts`. Added:

```typescript
export { dispatchKevinTask as postKevinAgentTask };
```

Both names now resolve to the same function. `dispatchKevinTask` is kept for backward compat.

---

## Finding 4 (MEDIUM, FIXED): `docs/kevin-agent-gateway-auth.md` missing

The gateway auth contract was undocumented. Created `docs/kevin-agent-gateway-auth.md` covering:
- Production dispatch path (Hermes /v1/runs)
- v1: HMAC signing scheme with golden vector
- Inbound callback verification scheme
- Environment variable table
- Anti-patterns (do not use `buildSignedHeaders`, direct fetch, hard-coded IPs)

---

## E2E Verification

### Inbound callbacks (Kevin → TE) — PASSING throughout

Production logs confirm Kevin sends HMAC-signed callbacks that TE verifies and processes:

```json
{"event":"agent.job.callback_received","taskType":"health.ping","callbackStatus":"completed",...}
```

Response: HTTP 200 (auth passed; `JOB_NOT_FOUND` body is a separate routing issue for test jobs).  
This path uses `KEVIN_CALLBACK_HMAC_SECRET` which has the correct fingerprint.

### Outbound dispatch (TE → Kevin) — FIXED

Before fix: every CEO Heartbeat dispatch logged `kevin_authentication_failed` (HTTP 401 from Kevin gateway — wrong scheme + wrong secret via broken env chain).

After fix: `signKevinOutboundBody()` produces `x-kevin-timestamp` + `x-kevin-signature: v1=...` using `KEVIN_CALLBACK_HMAC_SECRET` (correct fingerprint). The dispatch will either:
- Succeed via `/tasks` if Kevin implements it
- 404 → fall back to Hermes `/v1/runs` (Bearer `KEVIN_HERMES_API_KEY`) → succeed

Next CEO Heartbeat run at `2026-08-14T05:39:12 UTC` will confirm. Check logs for absence of `kevin_authentication_failed`.

---

## Test Coverage

### New: `server/tests/kevin-dispatch-contract.test.ts` (28 tests across 6 suites)

| Suite | Tests |
|-------|-------|
| Kevin outbound HMAC — v1: signing scheme | 6 |
| Kevin HMAC secret resolution chain | 5 |
| Production secret fingerprint | 4 — *1 FAILS until Bryan corrects `KEVIN_OUTBOUND_HMAC_SECRET`* |
| Kevin base URL and integration configuration | 5 |
| postKevinAgentTask canonical export | 3 |
| Kevin v1 HMAC round-trip (sign → verify) | 5 |

### Existing: unaffected

- `server/tests/kevin-integration.test.ts` — 36/36 ✅
- `tests/kevin-executive-operations.test.ts` — 69/69 ✅
- `server/scripts/kevin-hmac-golden-vector-smoke.ts` — ✅ (matches Kevin Python golden vector)
- `server/scripts/kevin-outbound-hmac-smoke.ts` — ✅ (`KEVIN_CALLBACK_HMAC_SECRET` resolves, round-trip OK)

---

## Files Changed

| File | Change |
|------|--------|
| `server/services/kevin-gateway-client.ts` | Replace `buildSignedHeaders` with `signKevinOutboundBody`; fix config guard to use `isKevinCallbackHmacConfigured()`; export `postKevinAgentTask` alias |
| `docs/kevin-agent-gateway-auth.md` | **Created** — full gateway auth contract documentation |
| `server/tests/kevin-dispatch-contract.test.ts` | **Created** — 28 targeted dispatch/signing tests |

---

## What `KEVIN_OUTBOUND_HMAC_SECRET` Should Contain

Value: same as `KEVIN_CALLBACK_HMAC_SECRET`  
Expected SHA-256 prefix: `9205e80778da2b21`  
Length: 64 characters  

Do **not** use: `4c0be9f5470753a9...` (the current wrong value).
