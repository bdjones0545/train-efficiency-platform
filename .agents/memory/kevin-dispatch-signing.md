---
name: Kevin Dispatch Signing Contract
description: TE → Kevin outbound HMAC signing scheme, secret resolution, and known env mismatch.
---

# Kevin Dispatch Signing Contract

## Rule
`kevin-gateway-client.ts` MUST use `signKevinOutboundBody()` from `server/services/kevin-outbound-auth.ts` for all outbound requests to Kevin. Never use `buildSignedHeaders` from `server/lib/kevin-hmac.ts` for Kevin requests.

**Why:** Kevin's gateway expects the `v1:` scheme (signing base = `v1:{timestampSec}:{rawBody}`, headers `x-kevin-timestamp` + `x-kevin-signature: v1={hex}`). `buildSignedHeaders` produces the legacy `X-TE-Signature` canonical-string scheme, which Kevin rejects with HTTP 401. The 401 does NOT trigger the Hermes fallback (only 404 does), so every dispatch silently fails.

**How to apply:** Whenever writing new TE → Kevin dispatch code, import from `kevin-outbound-auth.ts`, not `kevin-hmac.ts`. The config guard must use `isKevinCallbackHmacConfigured()` (reads chain), not `cfg.outboundHmacSecret` (reads KEVIN_OUTBOUND_HMAC_SECRET only).

## Secret resolution chain
```
KEVIN_CALLBACK_HMAC_SECRET → KEVIN_OUTBOUND_HMAC_SECRET → TRAINEFFICIENCY_KEVIN_SIGNING_SECRET
```
First non-empty wins. All three must hold identical values.

## Known env mismatch (as of 2026-08-14)
- `KEVIN_CALLBACK_HMAC_SECRET`: correct fingerprint `9205e80778da2b21` ✅
- `TRAINEFFICIENCY_KEVIN_SIGNING_SECRET`: correct fingerprint `9205e80778da2b21` ✅  
- `KEVIN_OUTBOUND_HMAC_SECRET`: WRONG fingerprint `4c0be9f5470753a9` ❌
- Must be corrected by Bryan in Replit Secrets (copy value from KEVIN_CALLBACK_HMAC_SECRET)
- Canary test in `server/tests/kevin-dispatch-contract.test.ts` will fail until corrected

## Canonical export
`postKevinAgentTask` is the canonical name (alias for `dispatchKevinTask`). Both exported from `server/services/kevin-gateway-client.ts`.

## Golden vector
```
secret    = test-vector-secret-32chars-aaaaaa
timestamp = 1700000000
rawBody   = {"schemaVersion":"1.0","event":"task.completed",...}
base      = v1:1700000000:{rawBody}
expected  = v1=568c43f21fea083dc71f1e355a80f0ab1254766b229a7fbd11aaf61b48df4a17
```
Smoke: `npx tsx server/scripts/kevin-hmac-golden-vector-smoke.ts`
