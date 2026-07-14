# Kevin × TrainEfficiency Integration — Runbook

**Last updated:** 2026-07-14  
**Phases implemented:** 0–3 (Phase 3 = this document)

---

## Table of Contents

1. [Architecture Overview](#1-architecture-overview)
2. [Environment Variables](#2-environment-variables)
3. [Feature Flags](#3-feature-flags)
4. [Kevin Capabilities Table](#4-kevin-capabilities-table)
5. [Event Pipeline](#5-event-pipeline)
6. [Signal Intake](#6-signal-intake)
7. [Context Retrieval](#7-context-retrieval)
8. [Outcome Forwarding](#8-outcome-forwarding)
9. [Circuit Breaker](#9-circuit-breaker)
10. [Loop Prevention](#10-loop-prevention)
11. [Security & PII Rules](#11-security--pii-rules)
12. [Navigation Registry](#12-navigation-registry)
13. [Not-Yet-Available Hermes Endpoints](#13-not-yet-available-hermes-endpoints)
14. [Runbook: Troubleshooting](#14-runbook-troubleshooting)

---

## 1. Architecture Overview

```
  TE Domain Agents             Kevin / Hermes
  ─────────────────           ────────────────
  CEO Heartbeat  ───context──▶  /v1/context/query  (Phase 3)
  Executive Agent──context──▶  /v1/context/query  (Phase 3)
  Decision Journal──event───▶  /v1/events          (Phase 3)
  AgentMail       ──event───▶  /v1/events          (Phase 3)
  Lead Intake     ──event───▶  /v1/events          (Phase 3)
  Outcome Service ──outcome──▶ /v1/outcomes         (Phase 3)
                  ◀──signal─── /api/internal/kevin/signals (Phase 3)
```

**Domain agent ownership is unchanged.** Kevin provides historical context and cross-agent memory. Kevin does NOT own scheduling, AgentMail, or athlete data. TE domain agents remain authoritative for their domains.

**Kevin integration layers:**

| Layer | What it does | Gate |
|-------|-------------|------|
| Health | Check Hermes reachability | `KEVIN_INTEGRATION_ENABLED` |
| Capabilities | View Kevin's available tools | `KEVIN_INTEGRATION_ENABLED` |
| Runs | Async ops-chat sessions | `KEVIN_INTEGRATION_ENABLED` |
| Event pipeline | Queue TE lifecycle events → Kevin | `KEVIN_EVENT_DISPATCH_ENABLED` |
| Context retrieval | Kevin historical context → TE agents | `KEVIN_CONTEXT_RETRIEVAL_ENABLED` |
| Signal intake | Kevin → TE Attention Inbox | `KEVIN_INTEGRATION_ENABLED` |
| Outcome forwarding | TE approval outcomes → Kevin learning | `KEVIN_OUTCOME_FORWARDING_ENABLED` |

---

## 2. Environment Variables

```bash
# ─── Master integration switch ─────────────────────────────────────────────
KEVIN_INTEGRATION_ENABLED=false           # Must be "true/1/yes" to enable

# ─── Hermes endpoint ───────────────────────────────────────────────────────
KEVIN_HERMES_BASE_URL=https://hermes.example.com   # No trailing slash
KEVIN_HERMES_API_KEY=<secret>             # Bearer token for Hermes API

# ─── Internal service-to-service auth ─────────────────────────────────────
TE_INTERNAL_SERVICE_TOKEN=<secret>        # Min 24 chars. Kevin uses this
                                          # to POST /api/internal/kevin/signals

# ─── Feature flags (independent, default off) ─────────────────────────────
KEVIN_EVENT_DISPATCH_ENABLED=false        # Enable outbound event queue flush
KEVIN_CONTEXT_RETRIEVAL_ENABLED=false     # Enable /v1/context/query calls
KEVIN_OUTCOME_FORWARDING_ENABLED=false    # Enable /v1/outcomes forwarding

# ─── Behaviour ─────────────────────────────────────────────────────────────
KEVIN_SIGNAL_INTAKE_ENABLED=false         # Signal intake — default OFF.
                                          # Enable only after TE_INTERNAL_SERVICE_TOKEN
                                          # is set AND Stage 3 (outcomes) verified.
```

### Rotation procedure for TE_INTERNAL_SERVICE_TOKEN

1. Generate a new secret (≥ 32 chars): `openssl rand -hex 32`
2. Add `TE_INTERNAL_SERVICE_TOKEN_NEW=<new-secret>` to env
3. Update Kevin's outbound config to use the new secret
4. Rename `TE_INTERNAL_SERVICE_TOKEN=<new-secret>` and remove `_NEW`
5. No restart required (middleware reads from `process.env` at request time)

---

## 3. Feature Flags

All flags use `truthy()` interpretation: `"1"`, `"true"`, or `"yes"` are true.

**Staged activation sequence (recommended):**

```
Stage 1: KEVIN_INTEGRATION_ENABLED=true
         KEVIN_CONTEXT_RETRIEVAL_ENABLED=true
         → Verify CEO Heartbeat context requests appear in kevin_context_requests
         → Confirm heartbeat continues when Hermes is unavailable

Stage 2: KEVIN_EVENT_DISPATCH_ENABLED=true
         → Verify: POST /api/admin/kevin/events/flush returns sent > 0
         → Verify: no duplicate delivery (idempotency_key stays unique)

Stage 3: KEVIN_OUTCOME_FORWARDING_ENABLED=true
         → Approve/reject an AgentMail draft
         → Verify: kevin_outcomes row appears with correct outcome type
         → Verify: forward_status transitions to 'forwarded' after flush

Stage 4: TE_INTERNAL_SERVICE_TOKEN=$(openssl rand -hex 32)   # min 32 chars
         KEVIN_SIGNAL_INTAKE_ENABLED=true
         → Test: POST /api/internal/kevin/signals with Bearer token → 201
         → Test: wrong token → 401
         → Test: correct token, depth=4 → 422 LOOP_DEPTH_EXCEEDED
         → Test: duplicate signal → 200 with status=duplicate
```

---

## 4. Kevin Capabilities Table

Each org has per-capability control with approval mode:

```
disabled → observe → recommend → draft → require_approval → auto
```

**Default: `observe`** — Kevin reads but does not act.

**`auto` mode does NOT bypass:**
- TE Autonomy Policy Engine
- AgentMail Send Guard
- Outbound Audit Log
- Any existing TE approval system

The Kevin capability layer is an additional gate only.

### Seeding

Capabilities are seeded automatically on first Kevin console access. They can also be seeded manually:

```
POST /api/admin/kevin/capabilities/seed
```

### Updating

```
PATCH /api/admin/kevin/capabilities/:capability
Body: { approvalMode: "observe" | "recommend" | ... , enabled: true }
```

---

## 5. Event Pipeline

### Queue architecture

```
enqueueKevinEvent()   ──DB INSERT──▶ kevin_events (status=pending)
                                          │
                              flushPendingKevinEvents() (every 5 min)
                                          │
                              hermesSubmitEvent()  ──HTTP──▶ Hermes /v1/events
                                          │
                              ──success──▶ status=sent
                              ──failure──▶ exponential retry (5 attempts)
                              ──dead letter──▶ Attention Inbox alert
```

### Retry schedule

| Attempt | Delay |
|---------|-------|
| 1 | 30 seconds |
| 2 | 2 minutes |
| 3 | 8 minutes |
| 4 | 30 minutes |
| 5 | 2 hours |

After 5 attempts → `dead_lettered`. An Attention Inbox item is created.

### Idempotency key format

```
{eventType}:{orgId}:{stableEntityId}
```
Example: `decision.recorded:org-123:dj-abc-456`

### Event types wired

| Wire-in point | Event type |
|---------------|-----------|
| Decision Journal | `te.decision.recorded` |
| AgentMail approve | `te.agentmail.reply.approved` |
| AgentMail reject | `te.agentmail.reply.rejected` |
| Lead Intake complete | `te.lead.intake.completed` |
| Outcome on Send | `te.communication.sent` |

---

## 6. Signal Intake

### Authentication

Signal intake is protected by `requireInternalServiceToken`. Kevin must provide:

```
Authorization: Bearer {TE_INTERNAL_SERVICE_TOKEN}
```

Browser session cookies are NOT valid for signal intake.

### Endpoint

```
POST /api/internal/kevin/signals
Content-Type: application/json
Authorization: Bearer {TE_INTERNAL_SERVICE_TOKEN}

{
  "org_id": "string",           // required
  "signal_type": "string",      // required (e.g. "pattern.detected")
  "title": "string",            // required
  "summary": "string",          // optional
  "external_signal_id": "string", // optional, for dedup
  "entity_type": "string",      // optional
  "entity_id": "string",        // optional
  "evidence": { ... },          // optional object (redacted for security signals)
  "confidence": 0.85,           // optional 0.0–1.0
  "risk_class": "medium",       // optional: low/medium/high/critical
  "source": "kevin",            // optional
  "trace_id": "string",         // optional, for loop prevention
  "depth": 0                    // optional, default 0, max 3
}
```

### Response

```json
{
  "ok": true,
  "signalId": "uuid",
  "status": "routed",
  "routedTo": "attention_inbox",
  "attentionItemId": "uuid"
}
```

### Signal routing table

| Signal type prefix | Risk class | Routed to |
|-------------------|-----------|-----------|
| `security.*` | any | Attention Inbox (critical) |
| any | critical | Attention Inbox (critical) |
| any | high | Attention Inbox (important) |
| `integration.*` | any | Attention Inbox (important) |
| `architecture.*` | any | CEO Heartbeat |
| `environment.*` | any | CEO Heartbeat |
| `memory.conflict` | any | Kevin Console |
| `pattern.*` | any | Attention Inbox (suggested) |
| `recommendation*` | any | Attention Inbox |
| default | any | Attention Inbox (suggested) |

### Deduplication

- External signal ID: same `external_signal_id` for same `org_id` → duplicate
- Application-level: same `(org_id, signal_type, entity_type, entity_id)` with `status=pending` → duplicate

---

## 7. Context Retrieval

Context requests call Hermes `/v1/context/query` on behalf of TE agents.

### PII rules (enforced at TE layer, never relaxed)

- ❌ NEVER send athlete names, email addresses, phone numbers
- ❌ NEVER send raw email body content
- ❌ NEVER send payment records or card data
- ❌ NEVER send credentials, API keys, or tokens
- ✅ Send: counts, statuses, high-level summaries, timestamps

### Context request trace

Every context request is stored in `kevin_context_requests`:

```sql
SELECT * FROM kevin_context_requests
WHERE org_id = 'your-org-id'
ORDER BY created_at DESC
LIMIT 20;
```

### Loop prevention

Context requests with `depth > 3` are blocked with status `blocked_loop`.

---

## 8. Outcome Forwarding

Outcome feedback is stored in `kevin_outcomes` and forwarded asynchronously to Hermes `/v1/outcomes`.

### Wired outcome paths

| Trigger | Outcome type |
|---------|-------------|
| AgentMail approved (no edits) | `accepted` |
| AgentMail approved (with edits) | `modified` |
| AgentMail rejected | `rejected` |
| Signal dismissed | `dismissed` |

---

## 9. Circuit Breaker

The circuit breaker is process-local (not distributed).

| State | Behavior |
|-------|---------|
| `closed` | All Kevin calls pass through |
| `open` | All Kevin calls fast-fail (returns empty/null) |
| `half_open` | One probe call allowed to test recovery |

- Opens after 5 failures in a 60-second rolling window
- Stays open for 60 seconds, then transitions to `half_open`
- Probe success → `closed`; probe failure → `open` again

**Validation errors from TE (bad input) are NOT counted as Kevin failures.**

### Viewing circuit state

```
GET /api/admin/kevin/circuit-breaker
```

---

## 10. Loop Prevention

Kevin signals and context requests carry a `depth` counter and `trace_id` to prevent feedback loops.

| Mechanism | Limit |
|-----------|-------|
| Context request depth | max 3 |
| Signal intake depth | max 3 |
| Event-triggered event | Not supported (events are one-way) |
| Attention Items from Kevin | `_preventKevinLoop: true` in metadata |

Attention Items created by Kevin signals have `metadata._preventKevinLoop = true`. Any system that generates new Kevin events MUST check for this flag and skip event enqueue.

---

## 11. Security & PII Rules

| Category | Rule |
|----------|------|
| Internal service token | Never log, never return in API responses |
| Security signal evidence | Redacted at intake, never stored in plain form |
| Athlete PII | Never sent to Kevin (names, emails, phones) |
| Raw email content | Never sent to Kevin |
| Payment data | Never sent to Kevin |
| Event payload sanitization | Automatic at `enqueueKevinEvent()` |
| Audit log payloads | Automatically sanitized (keys containing "password", "token", "secret", "key", etc. → `[redacted]`) |

---

## 12. Navigation Registry

Kevin may suggest navigation within TE. All routes are validated against `server/services/kevin-navigation-registry.ts`.

Kevin must NEVER generate arbitrary URLs. Every suggestion is validated:
1. Intent must be in the allowlist
2. Route must be in the allowlist
3. User role must have access
4. User must click the suggestion — no automatic redirects

---

## 13. Not-Yet-Available Hermes Endpoints

The following Hermes endpoints are not yet available. TE-side infrastructure is implemented and queuing is active. Enable the corresponding feature flag when the endpoint is ready.

| Endpoint | Feature flag | Status |
|----------|-------------|--------|
| `POST /v1/events` | `KEVIN_EVENT_DISPATCH_ENABLED` | TE ready, Hermes pending |
| `POST /v1/outcomes` | `KEVIN_OUTCOME_FORWARDING_ENABLED` | TE ready, Hermes pending |
| `POST /v1/context/query` | `KEVIN_CONTEXT_RETRIEVAL_ENABLED` | TE ready, Hermes pending |

---

## 14. Runbook: Troubleshooting

### Kevin console shows "unconfigured"

Check: `KEVIN_INTEGRATION_ENABLED`, `KEVIN_HERMES_BASE_URL`, `KEVIN_HERMES_API_KEY` are all set.

### Signal intake returning 503

`TE_INTERNAL_SERVICE_TOKEN` is not configured. Set it to a string ≥ 24 characters.

### Signal intake returning 401

Kevin is sending the wrong token. Verify Kevin's outbound config matches `TE_INTERNAL_SERVICE_TOKEN`.

### Events stuck in `pending`

`KEVIN_EVENT_DISPATCH_ENABLED` is `false`, or Hermes `/v1/events` is not yet available. This is expected until Hermes provides the endpoint.

### Circuit breaker stuck in `open`

```
GET /api/admin/kevin/circuit-breaker
```

If Hermes is back up, the circuit should recover to `half_open` after 60 seconds and close on first successful probe.

To manually check Hermes health:

```
GET /api/admin/kevin/health
```

### Context requests all showing `disabled`

Either `KEVIN_CONTEXT_RETRIEVAL_ENABLED` is false, or the capability `cross_application_context` (or the specific capability for the agent) is set to `disabled` or below `observe`. Check:

```sql
SELECT * FROM kevin_capabilities WHERE org_id = 'your-org';
```

### Dead-lettered events

```sql
SELECT id, event_type, attempts, last_error, dead_lettered_at
FROM kevin_events
WHERE status = 'dead_lettered'
ORDER BY dead_lettered_at DESC
LIMIT 20;
```

An Attention Inbox item is created for each dead-lettered event. After fixing the root cause, you can reset events for retry:

```sql
UPDATE kevin_events
SET status = 'pending', next_retry_at = NOW(), attempts = 0
WHERE status = 'dead_lettered' AND org_id = 'your-org';
```

---

## 15. Route Authentication Classification

| Route | Auth | Note |
|---|---|---|
| `GET /api/kevin/health` | isAuthenticated + ADMIN | Browser session |
| `GET /api/kevin/capabilities` | isAuthenticated + ADMIN | Browser session |
| `GET /api/kevin/config-status` | isAuthenticated + ADMIN | Browser session |
| `GET /api/kevin/audit` | isAuthenticated + ADMIN | Browser session |
| `POST /api/kevin/runs` | isAuthenticated + ADMIN | Browser session |
| `GET /api/kevin/runs` | isAuthenticated + ADMIN | Browser session |
| `GET /api/kevin/runs/:id` | isAuthenticated + ADMIN | Browser session |
| `POST /api/kevin/runs/:id/stop` | isAuthenticated + ADMIN | Browser session |
| `GET /api/kevin/runs/:id/events` | isAuthenticated + ADMIN | Browser session (SSE) |
| `GET /api/admin/kevin/circuit-breaker` | isAuthenticated + ADMIN | Browser session |
| `GET /api/admin/kevin/capabilities` | isAuthenticated + ADMIN | Browser session |
| `PATCH /api/admin/kevin/capabilities/:cap` | isAuthenticated + ADMIN | Browser session |
| `POST /api/admin/kevin/capabilities/seed` | isAuthenticated + ADMIN | Browser session |
| `GET /api/admin/kevin/events` | isAuthenticated + ADMIN | Browser session |
| `POST /api/admin/kevin/events/flush` | isAuthenticated + ADMIN | Browser session |
| `GET /api/admin/kevin/outcomes` | isAuthenticated + ADMIN | Browser session |
| `GET /api/admin/kevin/context-requests` | isAuthenticated + ADMIN | Browser session |
| `GET /api/admin/kevin/signals` | isAuthenticated + ADMIN | Browser session |
| `GET /api/admin/kevin/signals/:id` | isAuthenticated + ADMIN | Browser session |
| `POST /api/admin/kevin/signals/:id/dismiss` | isAuthenticated + ADMIN | Browser session |
| `GET /api/admin/kevin/signals/stats` | isAuthenticated + ADMIN | Browser session |
| **`POST /api/internal/kevin/signals`** | **TE_INTERNAL_SERVICE_TOKEN bearer only** | **Machine-to-machine. Browser session NOT accepted.** |

### Internal token security properties
- Timing-safe comparison (SHA-256 hash, constant-time `timingSafeEqual`)
- Never logged, never returned in responses, never included in client bundle
- Missing or too-short token (< 24 chars): returns **503** (fail-closed, unambiguous)
- Correct token + no browser session: **accepted** (intended machine-to-machine use)
- Valid ADMIN browser session + no token: **rejected 401**
- Feature gate checked AFTER token validation so Kevin gets a clear 503 (not 401) when intake is disabled

---

## 16. Hermes Endpoint Readiness Matrix

| Endpoint | Status | Flag | TE contract |
|---|---|---|---|
| `GET /health` | ✅ When Hermes is up | `KEVIN_INTEGRATION_ENABLED` | `{ status }` |
| `GET /health/detailed` | ✅ When Hermes is up | `KEVIN_INTEGRATION_ENABLED` | `{ gateway_state, readiness }` |
| `GET /v1/capabilities` | ✅ When Hermes is up | `KEVIN_INTEGRATION_ENABLED` | `{ features: { runs, sse, approvals } }` |
| `POST /v1/runs` | ✅ When Hermes is up | `KEVIN_INTEGRATION_ENABLED` | `{ run_id, status }` |
| `GET /v1/runs/:id` | ✅ When Hermes is up | `KEVIN_INTEGRATION_ENABLED` | run object |
| `POST /v1/runs/:id/stop` | ✅ When Hermes is up | `KEVIN_INTEGRATION_ENABLED` | `{ ok }` |
| `GET /v1/runs/:id/events` | ✅ When Hermes is up | `KEVIN_INTEGRATION_ENABLED` | SSE stream |
| **`POST /v1/events`** | **⏳ Pending — Hermes endpoint not yet available** | `KEVIN_EVENT_DISPATCH_ENABLED` | `{ ok: true, event_id: string }` |
| **`POST /v1/context/query`** | **⏳ Pending — Hermes endpoint not yet available** | `KEVIN_CONTEXT_RETRIEVAL_ENABLED` | `{ summary, memories, patterns, confidence }` |
| **`POST /v1/outcomes`** | **⏳ Pending — Hermes endpoint not yet available** | `KEVIN_OUTCOME_FORWARDING_ENABLED` | `{ ok: true, outcome_id: string }` |

All three pending endpoints are fully implemented in `server/services/kevin-hermes-client.ts`.
They will activate automatically when the corresponding feature flag is set to `true` and
Hermes provides the endpoint. No code changes are required on the TE side.

---

## 17. Org Isolation Guarantees

Every query touching `kevin_*` tables includes an explicit `org_id` predicate.
The `org_id` is resolved from `user_profiles` for authenticated admin routes — never from the request body or query params.

Kevin cannot:
- Access another organization's capabilities, events, outcomes, signals, or context requests
- Select tools outside the TE capability catalogue
- Generate arbitrary navigation URLs (nav registry enforces an allowlist of valid TE admin routes)
- Bypass the Autonomy Policy Engine, AgentMail Send Guards, or outbound audit logging
- Cause a send without going through TE's existing approval chain (capability mode must be explicitly set to `auto` by an ADMIN)

---

## 18. Migration

**File:** `migrations/0001_kevin_tables.sql`

Creates all 9 Kevin tables plus 6 enum types using idempotent DDL:
- Enums: `DO $$ BEGIN CREATE TYPE ...; EXCEPTION WHEN duplicate_object THEN NULL; END $$`
- Tables: `CREATE TABLE IF NOT EXISTS`
- Indexes: `CREATE [UNIQUE] INDEX IF NOT EXISTS`

**Existing database (bootstrap path):** Safe to apply — all statements are no-ops if objects already exist.
**Empty database:** Fully reproducible from zero using this migration alone.
**Rollback:** Documented in the migration file header. Must be executed manually; no automatic rollback.
