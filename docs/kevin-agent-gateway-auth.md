# Kevin ↔ TrainEfficiency — Production Gateway Auth Contract

**Status:** Production  
**Last reviewed:** 2026-07-31  
**Owner:** Platform Engineering

---

## 1. Production dispatch path (current)

```
TE action
  → dispatchKevinTask() / postKevinAgentTask()   [kevin-gateway-client.ts]
  → POST https://kevin-api.trainefficiency.com/tasks  (signed, v1: scheme)
      → 404 (Kevin gateway exposes Hermes /v1/runs, not /tasks)
  → FALLBACK: dispatchViaHermesRun()             [kevin-hermes-dispatch.ts]
  → POST https://kevin-api.trainefficiency.com/v1/runs
      Authorization: Bearer KEVIN_HERMES_API_KEY
  → Kevin accepts, returns run_id
  → Background poll hermesGetRun() every 10 s, timeout 5 min
  → agent_jobs row updated to completed / failed
```

Kevin's live gateway (`kevin-api.trainefficiency.com`) is a **Hermes Agent API Server**.
It exposes `/v1/runs`, `/v1/runs/{id}`, `/v1/runs/{id}/events` — **not** `/tasks`.
The `/tasks` signed-callback contract is reserved for a future gateway upgrade.

---

## 2. TE → Kevin outbound HMAC (signed `/tasks` contract — future)

### Scheme: v1 (matches Kevin's agent_gateway `hmac_auth.py` golden vector)

```
signing base  = "v1:" + timestampSec + ":" + rawBody
signature     = HMAC-SHA256(secret, signing_base) → lowercase hex
header format = "v1=" + hex
```

### Request headers

| Header | Value |
|--------|-------|
| `Content-Type` | `application/json` |
| `x-kevin-timestamp` | Unix epoch **seconds** as decimal string |
| `x-kevin-signature` | `v1=<hex>` |
| `X-TE-Correlation-ID` | Correlation UUID (tracing; not part of HMAC) |
| `X-TE-Idempotency-Key` | Idempotency key (not part of HMAC) |

### Secret resolution (TE side)

The signing secret is resolved from the first non-empty variable in this chain:

1. `KEVIN_CALLBACK_HMAC_SECRET` ← **preferred TE/Replit name**
2. `KEVIN_OUTBOUND_HMAC_SECRET` ← alternate (must equal #1 when both set)
3. `TRAINEFFICIENCY_KEVIN_SIGNING_SECRET` ← legacy alias (must equal #1 when set)

> **Critical:** All three variables must hold **identical values**. `KEVIN_OUTBOUND_HMAC_SECRET`
> must not differ from `KEVIN_CALLBACK_HMAC_SECRET`. If they diverge, outbound signing
> uses the wrong secret and Kevin rejects the request.

Implementation: `signKevinOutboundBody()` in `server/services/kevin-outbound-auth.ts`.

### Golden vector (CI regression)

```
secret    = test-vector-secret-32chars-aaaaaa
timestamp = 1700000000
rawBody   = {"schemaVersion":"1.0","event":"task.completed","jobId":"job_fixed","status":"completed"}
base      = v1:1700000000:{rawBody}
expected  = v1=568c43f21fea083dc71f1e355a80f0ab1254766b229a7fbd11aaf61b48df4a17
```

Smoke test: `npx tsx server/scripts/kevin-hmac-golden-vector-smoke.ts`

---

## 3. Kevin → TE inbound callbacks

Kevin POSTs results to `{KEVIN_CALLBACK_BASE_URL}/api/kevin/webhooks/hermes`.

### Verification scheme (same v1 scheme, reverse direction)

```
base      = "v1:" + x-kevin-timestamp + ":" + rawBody
expected  = HMAC-SHA256(secret, base) → lowercase hex
verify    = timingSafeEqual(expected, x-kevin-signature.strip("v1="))
```

Secret resolved from same chain: `KEVIN_CALLBACK_HMAC_SECRET` → `KEVIN_OUTBOUND_HMAC_SECRET` → `TRAINEFFICIENCY_KEVIN_SIGNING_SECRET`.

Implementation: `verifyKevinCallbackHeaders()` in `server/services/kevin-outbound-auth.ts`.
Route handler: `server/kevin-webhook-routes.ts`.

---

## 4. Hermes API Server auth (current working path)

```
Authorization: Bearer KEVIN_HERMES_API_KEY
```

`KEVIN_HERMES_API_KEY` = same value as Kevin's `API_SERVER_KEY` in Hermes config.  
Never logged, never sent to browser.

---

## 5. Environment variables (TE Replit Secrets)

| Variable | Required | Purpose |
|----------|----------|---------|
| `KEVIN_AGENT_INTEGRATION_ENABLED` | Yes | Master switch (`true` / `1`) |
| `KEVIN_INTEGRATION_ENABLED` | Yes | Legacy alias for Hermes client |
| `KEVIN_HERMES_BASE_URL` | Yes | Hermes API Server base URL (e.g. `https://kevin-api.trainefficiency.com`) |
| `KEVIN_GATEWAY_BASE_URL` | Yes | Same as above — used by gateway client for `/tasks` |
| `KEVIN_HERMES_API_KEY` | Yes | Bearer token for Hermes `/v1/runs` |
| `KEVIN_CALLBACK_HMAC_SECRET` | Yes | Shared HMAC secret (Kevin↔TE) — **canonical name** |
| `KEVIN_OUTBOUND_HMAC_SECRET` | Yes | Must equal `KEVIN_CALLBACK_HMAC_SECRET` |
| `TRAINEFFICIENCY_KEVIN_SIGNING_SECRET` | Yes | Must equal `KEVIN_CALLBACK_HMAC_SECRET` |
| `KEVIN_CALLBACK_BASE_URL` | Prod | TE public origin for Kevin callbacks (e.g. `https://trainefficiency.com`) |
| `KEVIN_REQUEST_TIMEOUT_MS` | No | HTTP timeout ms (default 30000; Hermes creates use max(30000,value)) |
| `KEVIN_CALLBACK_ALLOWED_SKEW_SECONDS` | No | Max clock skew for inbound HMAC (default 300) |

---

## 6. Canonical dispatch function

```typescript
// server/services/kevin-gateway-client.ts
export { dispatchKevinTask as postKevinAgentTask } from "./kevin-gateway-client";
```

`dispatchKevinTask` (also exported as `postKevinAgentTask`) is the **single canonical entry point**
for all TE → Kevin task dispatch. Direct `fetch()` calls to Kevin are prohibited outside this helper.

---

## 7. Known anti-patterns (do not use)

- `buildSignedHeaders` from `server/lib/kevin-hmac.ts` for TE → Kevin requests
  (produces `X-TE-Signature` with canonical-string scheme — NOT the Kevin `v1:` contract)
- Direct `fetch()` to `kevin-api.trainefficiency.com` outside `kevin-gateway-client.ts`
- Reading `KEVIN_OUTBOUND_HMAC_SECRET` directly for signing (use the resolver chain)
- Hard-coded Kevin IPs or VM addresses
