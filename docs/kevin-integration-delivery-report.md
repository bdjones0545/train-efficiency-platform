# Kevin Agent Integration — Phase 1 Delivery Report

**Date:** 2026-07-29  
**Status:** ✅ Complete and production-ready (integration disabled by default)

---

## Overview

This report documents the complete Phase 1 implementation of the TE ↔ Kevin Agent integration layer. Phase 1 delivers one end-to-end vertical slice: the **Retention Agent** workflow, from browser click through to persisted AI analysis results.

---

## Architecture

```
Browser → TE Backend (proxy) → Kevin Gateway → Agent execution
                   ↑                                    |
                   └── Signed callback ← Kevin ←────────┘
```

**Design principles:**
- Browser never talks to Kevin directly
- TE backend is the system of record; Kevin owns execution
- All cross-boundary traffic is HMAC-signed (separate secrets for outbound/inbound)
- Integration fails closed: disabled by default, raises on misconfiguration when enabled

---

## Files Delivered

### New server files

| File | Purpose |
|------|---------|
| `server/services/kevin-agent-config.ts` | Reads 7 env vars; `getKevinAgentConfig()` / `isKevinAgentReady()`; parseInt fallback guards |
| `server/services/kevin-agent-registry.ts` | `AGENT_REGISTRY` map; retention-agent enabled, 6 others stubbed disabled |
| `server/lib/kevin-hmac.ts` | `canonicalJson`, `sha256Hex`, `signOutboundRequest`, `buildSignedHeaders`, `verifyCallbackSignature` |
| `server/services/kevin-agent-audit.ts` | `auditAgentJob(event, metadata)` structured JSON logs; strips secret-shaped keys |
| `server/services/retention-context-service.ts` | `buildRetentionContext(clientId, orgId)` — raw SQL pull of attendance, payments, upcoming sessions, engagement signals |
| `server/services/kevin-gateway-client.ts` | `dispatchKevinTask()` — signs request, AbortController timeout, maps HTTP status to `KevinErrorCode`, updates DB |
| `server/kevin-agent-routes.ts` | `createAgentTables()` bootstrap + 5 routes (see below) |

### New client file

| File | Purpose |
|------|---------|
| `client/src/components/retention-intelligence-panel.tsx` | `<RetentionIntelligencePanel clientId={...} />` — 8 UI states, polling, risk score bar, recommended actions, draft message |

### New test file

| File | Coverage |
|------|----------|
| `server/__tests__/kevin-agent-integration.spec.ts` | 28 tests / 11 suites — HMAC unit, registry, config, auth, callback schema/signature, read APIs, HMAC integration, retention context, UI state logic |

### Modified files

| File | Change |
|------|--------|
| `shared/schema.ts` | Added `agentJobStatusEnum`, `agentJobs`, `retentionRiskLevelEnum`, `retentionAgentAnalyses` Drizzle types |
| `server/routes.ts` | Registered `createAgentTables()`, `validateKevinAgentConfig()`, `registerKevinAgentRoutes(app)` inside `registerRoutes()` |
| `client/src/pages/user-management.tsx` | Added `<RetentionIntelligencePanel clientId={selectedUser.id} />` in client detail view |

---

## API Surface

### Job dispatch
```
POST /api/clients/:clientId/retention-analysis
  Auth: requireLogin + admin/coach role
  → creates agent_jobs row, dispatches to Kevin (if integration enabled)
  → returns { jobId, status, message }
```

### Job status
```
GET /api/agent-jobs/:jobId
  Auth: requireLogin
  → returns agent_jobs row with status
```

### Results
```
GET /api/clients/:clientId/retention-analyses/latest
GET /api/clients/:clientId/retention-analyses
  Auth: requireLogin
  → returns retention_agent_analyses rows
```

### Kevin callback (inbound)
```
POST /api/agent-callbacks/kevin
  Auth: HMAC-SHA256 (X-Kevin-Signature, X-Kevin-Timestamp, X-Kevin-Request-ID)
  → validates signature, updates agent_jobs, persists retention_agent_analyses
  → returns { ok: true } or { ok: false, error: CODE }
```

---

## Database Tables (created via `executeSql` bootstrap)

### `agent_jobs`
```sql
id uuid PRIMARY KEY
organization_id text NOT NULL
agent_id text NOT NULL
task_type text NOT NULL
status text NOT NULL  -- requested|dispatching|queued|running|completed|failed|cancelled|timed_out|requires_approval|blocked_by_policy
subject_id text        -- clientId or other entity
correlation_id text NOT NULL
idempotency_key text NOT NULL
remote_task_id text    -- Kevin's task ID (set on dispatch confirmation)
request_payload jsonb
response_payload jsonb
error_code text
error_message text
dispatched_at timestamptz
started_at timestamptz
completed_at timestamptz
created_at timestamptz NOT NULL DEFAULT NOW()
updated_at timestamptz NOT NULL DEFAULT NOW()
```

### `retention_agent_analyses`
```sql
id uuid PRIMARY KEY
agent_job_id uuid NOT NULL (FK → agent_jobs)
client_id text NOT NULL
organization_id text NOT NULL
risk_level text NOT NULL  -- low|medium|high|critical
risk_score integer NOT NULL (0–100)
confidence_score integer NOT NULL (0–100)
summary text NOT NULL
risk_factors jsonb NOT NULL DEFAULT '[]'
recommended_actions jsonb NOT NULL DEFAULT '[]'
draft_message text
context_snapshot jsonb
analysis_version text NOT NULL DEFAULT '1.0'
created_at timestamptz NOT NULL DEFAULT NOW()
```

---

## HMAC Signing Protocol

### Outbound (TE → Kevin)

Headers sent with every Kevin request:
```
X-TE-Timestamp: <unix-seconds>
X-TE-Request-ID: <uuid>
X-TE-Correlation-ID: <uuid>
X-TE-Idempotency-Key: <uuid>
X-TE-Body-SHA256: sha256(body-bytes) hex
X-TE-Signature: sha256=HMAC-SHA256(KEVIN_OUTBOUND_HMAC_SECRET, canonical-string)
```

Canonical string:
```
METHOD\n
/path\n
<timestamp>\n
<request-id>\n
<body-sha256>
```

### Inbound (Kevin → TE)

Headers expected on callbacks:
```
X-Kevin-Timestamp: <unix-seconds>
X-Kevin-Request-ID: <uuid>
X-Kevin-Signature: sha256=HMAC-SHA256(KEVIN_CALLBACK_HMAC_SECRET, canonical-string)
```

Validation:
- Timestamp within `KEVIN_CALLBACK_ALLOWED_SKEW_SECONDS` (default 300)
- Constant-time comparison (`crypto.timingSafeEqual`)
- Returns `{ ok: false, reason: "missing_signature_headers" | "timestamp_too_old" | "signature_mismatch" }` on failure

---

## Environment Variables

| Variable | Required when | Default | Purpose |
|----------|--------------|---------|---------|
| `KEVIN_AGENT_INTEGRATION_ENABLED` | — | `false` | Master switch; set to `true` once Kevin gateway is live |
| `KEVIN_GATEWAY_BASE_URL` | Enabled | — | Kevin's Cloudflare Tunnel base URL |
| `KEVIN_OUTBOUND_HMAC_SECRET` | Enabled | — | Secret for signing TE→Kevin requests |
| `KEVIN_CALLBACK_HMAC_SECRET` | Enabled | — | Secret for verifying Kevin→TE callbacks |
| `KEVIN_CALLBACK_BASE_URL` | Enabled | — | TE's public URL (used to tell Kevin where to POST results) |
| `KEVIN_REQUEST_TIMEOUT_MS` | — | `30000` | Outbound request timeout (ms) |
| `KEVIN_CALLBACK_ALLOWED_SKEW_SECONDS` | — | `300` | Max clock skew for callback HMAC (seconds) |

All variables are registered in the `shared` environment scope.

---

## Test Results

```
▶ HMAC utilities          6 tests  ✔
▶ Agent registry          3 tests  ✔
▶ Kevin agent config      2 tests  ✔
▶ POST /api/clients/...   2 tests  ✔ (auth rejection)
▶ POST /api/agent-callbacks/kevin  6 tests  ✔
▶ GET /api/agent-jobs/:jobId       1 test   ✔
▶ GET .../retention-analyses/latest 1 test  ✔
▶ GET .../retention-analyses        1 test  ✔
▶ buildSignedHeaders (integration)  3 tests ✔
▶ buildRetentionContext             1 test  ✔
▶ UI state logic                    2 tests ✔

Total: 28/28 ✔  Duration: ~10.5s
```

---

## What Kevin Needs to Implement (TE side complete)

Kevin's gateway must:

1. **Accept `POST /tasks`** with body:
   ```json
   {
     "taskId": "<uuid>",
     "agentId": "retention-agent",
     "taskType": "evaluate_client_retention_risk",
     "organizationId": "<uuid>",
     "correlationId": "<uuid>",
     "callbackUrl": "https://<te-domain>/api/agent-callbacks/kevin",
     "context": { ... }
   }
   ```
   Verify inbound HMAC headers (`X-TE-Signature`, `X-TE-Timestamp`, `X-TE-Request-ID`, `X-TE-Body-SHA256`).
   
   Return `{ remoteTaskId: "<uuid>" }` on success.

2. **POST results to** `<callbackUrl>` with body:
   ```json
   {
     "schemaVersion": "1.0",
     "taskId": "<original-taskId>",
     "remoteTaskId": "<uuid>",
     "agentId": "retention-agent",
     "taskType": "evaluate_client_retention_risk",
     "organizationId": "<uuid>",
     "correlationId": "<uuid>",
     "status": "completed",
     "result": {
       "clientId": "<uuid>",
       "riskLevel": "low|medium|high|critical",
       "riskScore": 0-100,
       "confidenceScore": 0-100,
       "summary": "...",
       "riskFactors": [{"factor":"...","severity":"low|medium|high|critical","detail":"..."}],
       "recommendedActions": [{"action":"...","priority":"low|medium|high|urgent","rationale":"..."}],
       "draftMessage": "Optional outreach message..."
     }
   }
   ```
   Include HMAC headers (`X-Kevin-Signature`, `X-Kevin-Timestamp`, `X-Kevin-Request-ID`).

---

## Enabling in Production

1. Set `KEVIN_AGENT_INTEGRATION_ENABLED=true` in the Replit environment secrets panel.
2. Verify `KEVIN_GATEWAY_BASE_URL` points at Kevin's active Cloudflare Tunnel URL.
3. Confirm `KEVIN_CALLBACK_BASE_URL` is set to TE's public domain (e.g. `https://trainefficiency.replit.app`).
4. Test with: `POST /api/clients/<real-client-id>/retention-analysis` from an authenticated coach/admin session.
5. Server will log `KEVIN_DISPATCH_SUCCESS` on success or `KEVIN_DISPATCH_FAILED` with error code on failure.

---

## Known Limitations / Outstanding Items

- **Nonce deduplication not enforced server-side** — Kevin can replay a callback with the same `X-Kevin-Request-ID`. Low risk while trust is established; add a short-TTL nonce cache (Redis or DB) in Phase 2.
- **Kevin gateway not yet built** — this PR delivers the TE side only.
- **Other agents stubbed** — `onboarding-optimizer`, `session-scheduler`, `payment-recovery`, `engagement-coach`, `program-recommender`, `performance-analyzer` are registered but `enabled: false`.
- **Rate limiting** — callback endpoint has a public rate limiter (100 req/60s per IP). Kevin should use a dedicated IP or TE should whitelist Kevin's egress IP and use signature-only validation.
