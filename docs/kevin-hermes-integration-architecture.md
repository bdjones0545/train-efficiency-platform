---
Document Type: Architecture
Verification Status: Design (implementation-ready; not yet built)
Last Reviewed: 2026-07-13
Owner: Platform Engineering + Kevin Ops
Related:
  - CLAUDE.md (Engineering Philosophy, AI Architecture, Governance)
  - docs/api-conventions.md
  - docs/agent-catalog.md
  - docs/core-services.md
  - docs/integrations.md
  - docs/schema.md
  - ~/.hermes/profiles/kevin/workspace/registry/TRAINEFFICIENCY.md
---

# Kevin ↔ TrainEfficiency Integration Architecture

> **Goal:** Make the TrainEfficiency Replit application the **primary user interface** for interacting with **Kevin**, while **Hermes (profile `kevin`)** remains the **persistent runtime and orchestration layer**.
>
> **Non-goal (this document):** Implement code. This is the production design that implementers must follow.

---

## 1. Executive summary

| Concern | Decision |
|---------|----------|
| UI surface | TrainEfficiency React client (Replit) — admin/ops “Kevin Console” + Approval Inbox + Health |
| Product BFF | TrainEfficiency Express API (`/api/kevin/*`) — session auth, org isolation, audit, policy |
| Agent runtime | Hermes Agent **profile `kevin`** on the ops host — tools, memory, skills, cron, kanban, MCP |
| Transport Kevin → TE | Hermes **API Server** platform (`gateway/platforms/api_server.py`) — OpenAI-compatible + `/v1/runs` + SSE |
| Identity of Kevin | Platform **operations orchestrator above** TE domain agents (Atlas, Pulse, Apex, …). Does **not** replace them |
| Secrets | Browser never sees Hermes keys. TE server holds `KEVIN_HERMES_API_KEY`. Hermes holds model keys |
| Data SoT | PostgreSQL (TE app data) · GitHub (software) · Obsidian (human knowledge) · Hermes state.db (Kevin sessions) |
| Safety | TE autonomy-policy + Hermes run approvals + dual audit trail; fail-closed on outbound/side-effect actions |

**One sentence:** TE owns users, tenants, UI, and business data; Kevin owns durable agent runtime, ops intelligence, and multi-system coordination; TE talks to Kevin only through a server-side BFF that speaks Hermes API Server contracts.

---

## 2. Context and constraints

### 2.1 Existing TrainEfficiency architecture (must preserve)

From `CLAUDE.md` and Version 2 docs:

- Full-stack TypeScript: **React client → Express 5 → services → PostgreSQL (Drizzle)**
- Multi-tenant isolation via **`organization_id`** (fail-closed org resolution)
- Auth: **Replit Auth / OIDC sessions** (clients) + email/password coaches; server-side `isAuthenticated` / `requireRole` / `requireAdmin`
- AI agents: 9 canonical identities (Atlas, Pulse, Apex, Tempo, Ledger, Relay, Vector, Nexus, Core) + Email Agent stack
- **CEO Orchestrator (Atlas)** already streams via **SSE** (`text/event-stream`, `data: …\n\n`, `[DONE]`)
- Governance: autonomy policy engine (fail-closed → `approval_required`), AgentMail send guard, `agent_pending_actions`, `autonomous_action_queue`, decision journal, `unified_agent_action_log`
- Existing **Hermes Learning** TE services (`hermes-service`, `hermes-learning-service`, `hermes-recommendation-engine`) write learnings / recommendations — these are **in-app learning loops**, not the Hermes Agent runtime
- External services are dependencies, not SoT; credentials via env / vault / Connectors
- API conventions: `/api/` prefix, no `/api/v1` versioning for product routes, kebab-case paths, dominant error shape `{ message }`, limit/offset pagination

### 2.2 Existing Hermes / Kevin capabilities (must leverage)

Hermes API Server (enabled on kevin gateway) already exposes:

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/health` | Liveness |
| GET | `/health/detailed` | Rich readiness (auth required) |
| GET | `/v1/models` | Advertised models |
| GET | `/v1/capabilities` | Machine-readable contract |
| POST | `/v1/chat/completions` | OpenAI chat (stream optional); session via `X-Hermes-Session-Id` |
| POST | `/v1/responses` | Responses API (stateful) |
| POST | `/v1/runs` | Async agent run → `202` + `run_id` |
| GET | `/v1/runs/{run_id}` | Run status |
| GET | `/v1/runs/{run_id}/events` | **SSE** lifecycle (tool progress, approvals, deltas) |
| POST | `/v1/runs/{run_id}/approval` | Resolve host tool approval: `once\|session\|always\|deny` |
| POST | `/v1/runs/{run_id}/stop` | Interrupt run |
| GET/POST/… | `/api/sessions*` | First-class Hermes session CRUD + chat stream |
| GET | `/v1/skills`, `/v1/toolsets` | Capability discovery |

Auth: **Bearer `API_SERVER_KEY`**.

Kevin profile already: gateway supervisor scripts, kanban ecosystem board, cron health watchdogs, Composio Slack `#kevin-ops`, AgentMail/AgentPhone MCP, decision log under `workspace/decisions/`.

### 2.3 Role separation (critical product boundary)

| Actor | Scope | Replaces? |
|-------|-------|-----------|
| **Atlas** (`executive_agent`) | In-process org business intelligence; admin chat synthesis | No |
| **Domain agents** (Pulse, Apex, …) | Org-scoped product workflows | No |
| **Hermes Learning (TE services)** | Outcome → learning tables / Obsidian notes | No |
| **Kevin (Hermes profile)** | Cross-system ops intelligence, Hermes ecosystem health, TE subsystem coordination, multi-agent workforce management, escalation to Bryan | **Not** a 10th product agent that steals Atlas’s chat |

Kevin may **call into** TE domain systems via governed APIs/tools. Atlas may **surface** Kevin health/summaries. They collaborate; they do not merge runtimes.

---

## 3. Overall architecture

### 3.1 Logical diagram

```
┌─────────────────────────────────────────────────────────────────────────┐
│                     TrainEfficiency (Replit)                            │
│  ┌──────────────────────┐    session cookie / OIDC                      │
│  │ React client         │◄──────────────────────────────────────────┐   │
│  │ · Kevin Console      │                                           │   │
│  │ · Approval Inbox     │                                           │   │
│  │ · Health / Runs      │                                           │   │
│  └──────────┬───────────┘                                           │   │
│             │ HTTPS /api/kevin/*                                    │   │
│             ▼                                                       │   │
│  ┌──────────────────────────────────────────────────────────────┐   │   │
│  │ Express BFF  server/routes/kevin-routes.ts                   │   │   │
│  │  isAuthenticated → requireAdmin|ops role → resolveOrgId      │   │   │
│  │  Zod validate → policy gates → KevinHermesClient             │   │   │
│  │  audit write (PG) → map SSE → client                         │   │   │
│  └─────┬───────────────────────────────┬────────────────────────┘   │   │
│        │                               │                            │   │
│        │ org-scoped context            │ TE domain reads (services) │   │
│        ▼                               ▼                            │   │
│  PostgreSQL (SoT app data)      Atlas / Pulse / queues / heartbeat    │
└────────┬────────────────────────────────────────────────────────────┘
         │ mTLS or private HTTPS + Bearer API_SERVER_KEY
         │ (network allowlist; never browser-direct)
         ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                 Ops host — Hermes profile `kevin`                       │
│  ┌──────────────────────────────────────────────────────────────────┐   │
│  │ Gateway (persistent)                                             │   │
│  │  · API Server platform :8642 (or private reverse proxy)          │   │
│  │  · Webhooks (optional TE → Kevin events)                         │   │
│  │  · Cron + kanban dispatcher                                      │   │
│  │  · MCP: composio, agentmail, agentphone, obsidian, linear        │   │
│  └────────────────────────────┬─────────────────────────────────────┘   │
│                               ▼                                         │
│  Kevin AIAgent: skills, memory, tools, decision log, SOUL               │
│  Model providers (xAI / OpenAI / fallbacks) — keys only in kevin .env   │
└─────────────────────────────────────────────────────────────────────────┘
         │
         │ optional callbacks
         ▼
   Slack #kevin-ops · AgentMail · Obsidian vault · GitHub (via Composio)
```

### 3.2 Component responsibilities

| Component | Owns | Does not own |
|-----------|------|--------------|
| **TE React Kevin Console** | UX, streaming display, approval UX, empty/error states | Hermes keys, tool execution, model selection policy |
| **TE Express BFF** | AuthZ, tenant context injection, request shaping, audit rows, rate limits, SSE proxy | Long-running tool execution, Hermes memory |
| **KevinHermesClient** (`server/services/kevin-hermes-client.ts`) | HTTP/SSE client, retries, timeouts, error mapping | Business rules |
| **Hermes API Server** | Run lifecycle, tool execution, session store, approvals for host tools | TE org RBAC, TE UI |
| **Kevin agent** | Orchestration, health, routing to specialists, institutional memory | TE athlete PII persistence (must not dump PII into vault notes) |
| **TE domain agents** | Org product automation | Host filesystem / Hermes cron |

### 3.3 Design principles (aligned with TE + Kevin)

1. **Production-first** — incremental phases; no big-bang rewrite of Atlas or Email Agent.
2. **BFF pattern** — browser never calls Hermes directly.
3. **Typed boundaries** — Zod schemas in `shared/kevin/` for BFF contracts; Hermes wire format isolated behind client adapter.
4. **Receipt-first side effects** — every TE-visible action returns a typed receipt (`accepted | streaming | approval_required | blocked | failed`).
5. **Governance dual-gate** — TE policy for product side effects; Hermes approval for host-side destructive tools.
6. **Tenant isolation** — every Kevin invocation carries `orgId` + actor; Kevin tools that touch TE data must re-check org scope server-side.
7. **Graceful degradation** — if Kevin is down, TE product features continue; Kevin Console shows degraded state; Atlas chat still works.
8. **Auditability** — TE `kevin_runs` / `kevin_audit_events` + Hermes decision log + optional Obsidian ops notes (no secrets/PII).

---

## 4. Authentication and authorization

### 4.1 Layers

```
Browser
  → TE session (express-session / OIDC)  [existing]
  → BFF: isAuthenticated + requireKevinAccess(role)
  → KevinHermesClient: Authorization: Bearer ${KEVIN_HERMES_API_KEY}
  → Hermes API Server: validates API_SERVER_KEY
```

### 4.2 TE-side access control

**New capability flag (recommended):** `kevin_console` on org membership or platform role.

| Role | Kevin Console | Start runs | Resolve Hermes host approvals | Resolve TE product approvals | View cross-org |
|------|---------------|------------|-------------------------------|------------------------------|----------------|
| Platform operator (Bryan / superadmin) | Yes | Yes | Yes | Yes (all orgs they can access) | Yes if platform admin |
| Org ADMIN | Yes (own org) | Yes | Yes (runs they started / org-scoped) | Yes (org queues) | No |
| COACH | **No** (locked 2026-07-13 — ADMIN+ only for MVP) | No | No | No (use existing non-Kevin UIs) | No |
| CLIENT / STAFF | No | No | No | No | No |

> **Policy lock:** Coach access = **none**. `requireKevinAccess` must require ADMIN (or platform superadmin). Do not add a COACH capability flag without a new explicit decision.

Implement as:

```ts
// server/middleware/require-kevin-access.ts
// requireKevinAccess({ minRole: "ADMIN", capability: "kevin_console" })
```

Fail closed if capability unset.

### 4.3 Hermes-side authentication

| Secret | Location | Purpose |
|--------|----------|---------|
| `API_SERVER_KEY` | kevin `.env` | Hermes API Server bearer |
| `KEVIN_HERMES_API_KEY` | TE Replit Secrets | Same value as `API_SERVER_KEY` (or rotated dual-key later) |
| `KEVIN_HERMES_BASE_URL` | TE Secrets | e.g. `https://kevin-ops.internal:8642` |
| Model keys (`XAI_API_KEY`, `OPENAI_API_KEY`, …) | kevin `.env` only | Never in TE |

**Network:** Prefer private network / Tailscale / Cloudflare Tunnel / reverse proxy with IP allowlist. Do **not** expose `:8642` to the public internet without WAF + key + mTLS.

### 4.4 Actor context propagation (authorization continuity)

BFF injects a structured **Kevin invocation context** into every Hermes run as `instructions` prefix (and optional metadata header if added later):

```json
{
  "teContext": {
    "orgId": "org_…",
    "userId": "user_…",
    "roles": ["ADMIN"],
    "requestId": "req_…",
    "channel": "kevin_console",
    "environment": "production"
  }
}
```

Rules:

- Kevin tools that call back into TE **must** use a **service credential** scoped to that org (see §4.5), not the end-user cookie.
- Kevin must not trust client-supplied orgId without BFF minting.

### 4.5 TE → Kevin service callback auth (Kevin tools calling TE)

When Kevin needs live TE data or to enqueue product actions:

| Option | Recommendation |
|--------|----------------|
| A. **Org-scoped service tokens** table `kevin_service_tokens` (hashed, expire, scopes) | **Preferred** for production |
| B. Platform admin personal token | Dev only |
| C. Composio-mediated | For third-party apps already governed |

Scopes examples: `read:heartbeat`, `read:approvals`, `write:approval_decision`, `read:agents_status`. **No** blanket DB access.

Callback base URL: `TE_PUBLIC_API_BASE` known to Kevin env (e.g. Replit deployment URL).

---

## 5. API surface

### 5.1 Product BFF routes (TrainEfficiency Express)

Register via modular `registerKevinRoutes(app)` (follows `registerXRoutes` convention).  
All under `/api/kevin/*`. All require `isAuthenticated` + `requireKevinAccess` unless noted.

#### Health & discovery

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/kevin/health` | Aggregated TE-view of Kevin liveness + last success |
| GET | `/api/kevin/capabilities` | Proxied/cached Hermes `/v1/capabilities` + TE feature flags |
| GET | `/api/kevin/skills` | Proxied skill list (read-only) |

#### Sessions

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/kevin/sessions` | List TE-mapped sessions for actor/org |
| POST | `/api/kevin/sessions` | Create session (maps to Hermes session + PG row) |
| GET | `/api/kevin/sessions/:sessionId` | Session metadata |
| GET | `/api/kevin/sessions/:sessionId/messages` | History (filtered) |
| DELETE | `/api/kevin/sessions/:sessionId` | Soft-delete TE mapping; optional Hermes delete |
| POST | `/api/kevin/sessions/:sessionId/fork` | Branch conversation |

#### Runs (primary interaction model)

| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/kevin/runs` | Start Kevin run (async). Returns `202` + receipt |
| GET | `/api/kevin/runs` | List runs for org/actor (limit/offset) |
| GET | `/api/kevin/runs/:runId` | Status + summary |
| GET | `/api/kevin/runs/:runId/events` | **SSE** proxy of Hermes run events + TE envelopes |
| POST | `/api/kevin/runs/:runId/stop` | Interrupt |
| POST | `/api/kevin/runs/:runId/messages` | Follow-up message on same session (creates child run or session chat) |

#### Approvals

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/kevin/approvals` | Unified pending: Hermes host + TE product queues |
| POST | `/api/kevin/approvals/:approvalId/decide` | Approve/deny (routes to correct backend) |
| POST | `/api/kevin/runs/:runId/approval` | Direct Hermes host approval (when SSE shows `approval.requested`) |

#### Ops views

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/kevin/ops/summary` | Org + platform ops digest for Console home |
| GET | `/api/kevin/ops/agent-map` | Static+live map: TE agents vs Kevin status |
| GET | `/api/kevin/audit` | Paginated TE audit events for Kevin |
| POST | `/api/kevin/webhooks/hermes` | Optional inbound from Hermes (HMAC) for async notifications |

### 5.2 Hermes endpoints Kevin must expose (already present)

TE BFF **consumes** these; no new Hermes core required for Phase 1–2:

- `GET /health`, `GET /health/detailed`
- `GET /v1/capabilities`
- `POST /v1/runs`, `GET /v1/runs/{id}`, `GET /v1/runs/{id}/events`, `POST /v1/runs/{id}/approval`, `POST /v1/runs/{id}/stop`
- `POST /api/sessions`, `GET /api/sessions/{id}/messages`, `POST /api/sessions/{id}/chat/stream` (optional path for simple chat UX)
- `GET /v1/skills`, `GET /v1/toolsets`

**Hermes config (kevin profile):**

```yaml
# conceptual — set via hermes -p kevin config / env
platforms:
  api_server:
    enabled: true
    extra:
      host: "127.0.0.1"   # front with reverse proxy in prod
      port: 8642
# env:
# API_SERVER_ENABLED=true
# API_SERVER_KEY=<strong random>
# API_SERVER_PORT=8642
# API_SERVER_MODEL_NAME=kevin
```

### 5.3 Optional TE webhooks → Kevin

For event-driven ops (heartbeat finished, approval backlog, deploy hooks):

- Hermes webhook platform on kevin (port 8644) **or** BFF pushes `POST /v1/runs` with templated input.
- Prefer **BFF-initiated runs** (simpler auth) over exposing Hermes webhooks publicly.

---

## 6. Request and response schemas

Place Zod types in `shared/kevin/schemas.ts` so client + server share contracts.

### 6.1 Common envelopes

```ts
// TE BFF error (align with dominant TE convention)
type TeError = { message: string; code?: string; requestId?: string };

// Receipt-first result
type KevinReceipt =
  | { status: "accepted"; runId: string; sessionId: string; hermesRunId: string }
  | { status: "approval_required"; runId: string; approvalId: string; summary: string; riskClass: RiskClass }
  | { status: "blocked"; reason: string; policy?: string }
  | { status: "failed"; message: string; code?: string };

type RiskClass = "low" | "medium" | "high" | "critical";
```

### 6.2 `POST /api/kevin/runs`

**Request**

```ts
{
  message: string;                     // user natural language
  sessionId?: string;                  // continue TE-mapped session
  mode?: "ops_chat" | "health_review" | "approval_assist" | "inventory";
  clientRequestId?: string;            // idempotency key (UUID)
  contextHints?: {
    includeOrgSummary?: boolean;       // BFF may attach safe org snapshot
    includePendingApprovals?: boolean;
    includeAgentHealth?: boolean;
  };
  // NEVER accept model provider keys or raw hermes session keys from client
}
```

**Response `202`**

```ts
{
  receipt: {
    status: "accepted";
    runId: string;          // TE id (UUID)
    sessionId: string;      // TE session id
    hermesRunId: string;    // Hermes run_* id
  };
  eventsUrl: string;        // /api/kevin/runs/:runId/events
  statusUrl: string;
}
```

**BFF → Hermes `POST /v1/runs` body**

```ts
{
  input: string; // message + optional structured appendix context appendix
  instructions: string; // system addendum: teContext JSON + policy + role of Kevin
  session_id?: string; // Hermes session continuity
  model?: string; // optional route alias "kevin"
  // conversation_history?: { role, content }[]  // if not using session store
}
```

### 6.3 `GET /api/kevin/runs/:runId`

```ts
{
  id: string;
  orgId: string;
  userId: string;
  sessionId: string;
  hermesRunId: string;
  status: "queued" | "running" | "waiting_approval" | "completed" | "failed" | "stopped";
  mode: string;
  createdAt: string;
  updatedAt: string;
  summary?: string | null;
  errorMessage?: string | null;
  riskClass?: RiskClass | null;
  usage?: { inputTokens?: number; outputTokens?: number } | null;
}
```

### 6.4 SSE event schema (BFF → browser)

Mirror Hermes events; wrap in TE envelope for audit correlation:

```ts
type KevinSseEvent =
  | { type: "run.status"; runId: string; status: string; at: string }
  | { type: "message.delta"; runId: string; delta: string }
  | { type: "tool.progress"; runId: string; tool?: string; message?: string; data?: unknown }
  | { type: "approval.requested"; runId: string; approvalId: string; summary: string; riskClass: RiskClass; details?: unknown }
  | { type: "approval.responded"; runId: string; choice: string }
  | { type: "run.completed"; runId: string; summary?: string }
  | { type: "run.failed"; runId: string; message: string; code?: string }
  | { type: "heartbeat"; at: string }
  | { type: "done" };
```

Wire format (TE convention):

```
Content-Type: text/event-stream
Cache-Control: no-cache
Connection: keep-alive
X-Accel-Buffering: no

data: {"type":"message.delta","runId":"…","delta":"Hello"}\n\n
data: {"type":"done"}\n\n
```

Map Hermes events (`message.delta`, `approval.requested`, tool progress, etc.) → `KevinSseEvent`.

### 6.5 `POST /api/kevin/runs/:runId/approval`

**Request**

```ts
{
  choice: "once" | "session" | "always" | "deny" | "approve"; // approve → once
  resolveAll?: boolean;
  note?: string; // stored in TE audit only
}
```

**Response `200`**

```ts
{ ok: true; resolved: number; hermesRunId: string; status: string }
```

### 6.6 `POST /api/kevin/approvals/:approvalId/decide` (unified)

```ts
{
  decision: "approve" | "deny" | "edit";
  editedPayload?: unknown;   // for TE product approvals that allow edit-before-send
  note?: string;
}
```

Router logic:

```
if approval.source === "hermes_host" → KevinHermesClient.approveRun(...)
if approval.source === "agent_pending_actions" → existing TE approval executor
if approval.source === "autonomous_action_queue" → existing Hermes Learning queue path
if approval.source === "gmail_agent_actions" → existing Gmail approval path
```

### 6.7 Idempotency

- `clientRequestId` UNIQUE per org on `kevin_runs`
- Retries of `POST /runs` with same key return same receipt (200/202) without starting a second Hermes run

---

## 7. Event streaming / WebSocket

### 7.1 Decision: **SSE first, WebSocket later**

| Transport | Use |
|-----------|-----|
| **SSE** (primary) | Run events, chat tokens, approval prompts — matches TE Atlas/chat conventions and Hermes `/v1/runs/{id}/events` |
| WebSocket | **Phase 4+ only** if bi-directional mid-run steering (interrupt/steer) needs lower latency than POST stop/approval |

Rationale: TE already standardizes SSE; Hermes already provides run SSE; fewer moving parts through Replit proxies.

### 7.2 SSE proxy pattern

```
Browser EventSource(or fetch stream) 
  → GET /api/kevin/runs/:id/events  (cookie auth)
  → BFF opens GET {HERMES}/v1/runs/{hermesRunId}/events  (Bearer)
  → BFF maps + writes TE envelopes
  → On disconnect: BFF cancels upstream reader; does NOT auto-stop run (run continues; client can reconnect)
```

**Auth note:** `EventSource` cannot set `Authorization` headers. Prefer:

1. Cookie session on same origin (works), or  
2. `fetch` + `ReadableStream` with credentials (recommended for Kevin Console).

### 7.3 Reconnect

- Client stores `lastEventId` if BFF emits `id:` SSE fields
- BFF may snapshot last N events in Redis/PG for replay (Phase 2); Phase 1: reconnect hits `GET run` for status + continues live stream if still open

---

## 8. Approval workflow integration

### 8.1 Two approval planes

| Plane | What | Where decided | UI |
|-------|------|---------------|----|
| **A. Hermes host approvals** | Destructive shell, broad FS, credentialed host actions | Hermes `POST /v1/runs/{id}/approval` | Kevin Console inline + Approval Inbox |
| **B. TE product approvals** | Emails, SMS, bookings, outreach, trust registry changes | TE tables + autonomy policy | Existing UIs + unified Inbox |

Kevin **must not** auto-execute plane B without TE policy. TE **must not** auto-resolve plane A without a human (or explicit platform policy).

### 8.2 Unified Approval Inbox

BFF `GET /api/kevin/approvals` merges:

1. Active Hermes runs in `waiting_approval` for this org/user  
2. `agent_pending_actions` (pending, unexpired)  
3. `autonomous_action_queue` (Hermes Learning recommendations)  
4. Optional: Gmail agent pending, Composio queued_for_approval  

Each item normalized:

```ts
{
  approvalId: string;          // te-prefixed composite id
  source: "hermes_host" | "agent_pending_actions" | "autonomous_action_queue" | "gmail" | "composio";
  orgId: string;
  title: string;
  summary: string;
  riskClass: RiskClass;
  createdAt: string;
  expiresAt?: string | null;
  runId?: string | null;
  deepLink?: string | null;
}
```

### 8.3 Policy mapping

When BFF starts a run with `contextHints` that include pending approvals, Kevin may **recommend** decisions but default action is draft only.

When Kevin proposes TE side effects via callback API:

1. TE endpoint re-runs `autonomy-policy-engine`  
2. On `approval_required` → write pending row → return receipt to Kevin → Kevin surfaces to user via SSE  
3. On `blocked` → return 422 to Kevin  
4. On `auto_execute` → execute only if scope allows **and** action is not critical (money, mass email, legal)

### 8.4 Bryan / platform operator path

Critical host actions + multi-org issues:

- Notify Slack `#kevin-ops` via existing `kevin_ops_notify.sh` / Composio (already Kevin-side)  
- Also create TE approval row for Console visibility when org-scoped

---

## 9. Health monitoring

### 9.1 Probes

| Probe | Owner | Interval |
|-------|-------|----------|
| Hermes `GET /health` | TE BFF + Kevin host supervisor | 30–60s |
| Hermes `GET /health/detailed` | TE BFF (admin) | 1–5 min |
| Kevin gateway ensure loop | Host scripts (existing) | 120s |
| TE `GET /healthz` | Replit / uptime | existing |
| Synthetic `POST /v1/runs` “ping” | TE cron (optional) | 15 min (prod) |

### 9.2 TE-facing health model

```ts
type KevinHealth = {
  status: "healthy" | "degraded" | "down" | "unconfigured";
  hermesReachable: boolean;
  gatewayState?: string;
  activeRuns?: number;
  lastSuccessfulRunAt?: string | null;
  lastError?: string | null;
  modelConfigured: boolean;
  features: { runs: boolean; sse: boolean; approvals: boolean };
  checkedAt: string;
};
```

Console shows banner if not healthy. **Product features outside Kevin continue.**

### 9.3 Alerting

- Host: existing Kevin health_alert cron → Slack `#kevin-ops`  
- TE: if Hermes down > N minutes, optional admin in-app alert + Slack for platform ops  
- Avoid dual spam: TE alerts only when user-facing Console is broken; host alerts for infrastructure

---

## 10. Session management

### 10.1 Dual session model

| Layer | ID | Store |
|-------|----|-------|
| TE browser session | cookie | `sessions` / `org_sessions` (existing) |
| TE Kevin chat session | `kevin_sessions.id` | PostgreSQL |
| Hermes session | `hermes_session_id` | Hermes `state.db` via API Server |

Mapping table `kevin_sessions`:

| Column | Notes |
|--------|-------|
| id | UUID PK |
| org_id | tenant |
| user_id | actor |
| hermes_session_id | from API Server |
| title | optional |
| mode | ops_chat, … |
| status | active/archived |
| created_at / updated_at | |
| last_run_id | FK soft |

### 10.2 Continuity strategy

**Preferred:** Hermes first-class sessions (`POST /api/sessions` + chat/stream or runs with `session_id`).  
**Fallback:** BFF loads last K messages from TE cache / Hermes messages API and sends `conversation_history` on `/v1/runs`.

### 10.3 Isolation

- Session list filtered by `org_id` + `user_id` (admins may see org-wide if flag set)  
- Hermes `X-Hermes-Session-Key` for memory scoping: derive as `te:{orgId}:{userId}` (stable) — **not** shared across orgs  
- Host tool approval keys remain **per run_id** (Hermes already isolates approvals per run)

### 10.4 Retention

- TE soft-delete sessions after policy (e.g. 90 days inactive)  
- Hermes prune via existing sessions tools / cron  
- Audit events retained longer than chat text if compliance requires

---

## 11. Error handling and recovery

### 11.1 Mapping Hermes → TE

| Hermes / network | TE HTTP | Client UX |
|------------------|---------|-----------|
| Connection refused / timeout | 503 `{ message, code: "KEVIN_UNAVAILABLE" }` | Degraded banner; retry |
| 401 from Hermes | 503 + ops alert (misconfig) | “Kevin misconfigured” |
| 429 concurrency | 429 with Retry-After | Queue message |
| Run failed mid-stream | SSE `run.failed` | Show error + partial transcript |
| Approval timeout | run status `failed` or stuck `waiting_approval` | Inbox shows expired |
| Partial SSE disconnect | Client reconnect | Status endpoint reconciles |

### 11.2 Run recovery

1. BFF persists `kevin_runs` row **before** calling Hermes (status `queued`)  
2. On Hermes 202, store `hermes_run_id`, status `running`  
3. Background reconciler (every 60s): for non-terminal TE runs, poll Hermes `GET /v1/runs/{id}` and update  
4. If Hermes loses run state (process restart): mark TE run `failed` with `code: "HERMES_STATE_LOST"`; user can retry with new run + same session  

### 11.3 Idempotent retries

- Create run: `clientRequestId`  
- Approval decide: store decision row UNIQUE(approvalId)  
- Callbacks TE←Kevin: `Idempotency-Key` header on service tokens  

### 11.4 Circuit breaker

`KevinHermesClient`:

- After K consecutive failures, open circuit for T seconds  
- Health endpoint reflects open circuit  
- Does not take down TE process  

---

## 12. Audit logging

### 12.1 TE tables (new)

**`kevin_runs`** — one row per invocation (see §6.3 fields + `client_request_id`, `instructions_hash`, `raw_error`).

**`kevin_audit_events`** — append-only:

| Column | Purpose |
|--------|---------|
| id | UUID |
| org_id, user_id | tenant/actor |
| run_id | nullable |
| event_type | `run.started`, `sse.proxy`, `approval.decided`, `callback.invoked`, `health.check`, … |
| payload | jsonb (redacted) |
| ip, user_agent | optional |
| created_at | |

**`kevin_sessions`** — §10.

### 12.2 Redaction

Never persist: API keys, raw `.env`, full athlete PII dumps, payment PANs.  
Run message text: allowed for ops admins; optional retention flag per org.

### 12.3 Hermes / Kevin side

- Decision log: `workspace/decisions/*.md` for non-trivial ops decisions  
- Hermes session transcripts in profile `state.db`  
- Slack `#kevin-ops` for actionable alerts only  

### 12.4 Correlation IDs

Propagate `requestId` / `runId` / `hermesRunId` across:

- TE logs  
- SSE events  
- Hermes instructions context  
- Slack alerts  

---

## 13. Security considerations

1. **No browser → Hermes** direct calls.  
2. **Bearer key** high entropy; rotate with dual-key overlap.  
3. **Private network** for Hermes API; WAF if public.  
4. **Tenant isolation** on every BFF query and every TE callback.  
5. **Prompt injection**: treat Kevin outputs as untrusted for side effects; only structured TE endpoints execute product actions after policy.  
6. **SSRF**: KevinHermesClient allowlist base URL; TE callbacks allowlist Kevin egress if reverse path added.  
7. **Tool blast radius**: Kevin approvals.mode remains `smart` / non-yolo; cron_mode deny for destructive.  
8. **PII**: Kevin briefing already forbids learner/athlete PII in vault markdown; BFF context builders send aggregates, not raw PHI/PII dumps.  
9. **Rate limits**: per-user and per-org on `POST /api/kevin/runs` (e.g. 20/hour org default; higher for platform admin).  
10. **CORS**: same-origin Console only.  
11. **Dependency**: Hermes downtime ≠ TE data corruption; fail soft.  
12. **Secrets storage**: TE Replit Secrets + kevin `.env` mode 600; never commit.  

---

## 14. Scalability recommendations

| Dimension | Phase 1 | Growth path |
|-----------|---------|-------------|
| Hermes concurrency | `max_concurrent_runs` low (2–4) | Raise carefully; queue in TE |
| Multi-instance TE | Sticky sessions for SSE; shared PG | Redis for SSE fanout / run event buffer |
| Multi-instance Hermes | Single writer profile host | Horizontal: split API server workers or per-tenant queues (later) |
| Long runs | Async `/v1/runs` only | Job queue already on Kevin cron/kanban |
| Context size | BFF attaches small org digests | Precompute ops snapshots table |
| Observability | Structured logs + audit tables | Metrics: run latency, approval wait, error rate |
| Model cost | Cap max turns; mode-based toolsets | Route simple modes to cheaper models |

**Important TE note:** Many TE crons are in-process timers; Kevin integration must not add another unguarded multi-instance double-runner on TE. Prefer BFF calling Hermes over embedding new TE `setInterval` for Kevin heartbeats (Kevin already has host cron).

---

## 15. Data model (Drizzle additions — sketch)

```text
kevin_sessions
  id uuid PK
  org_id text NOT NULL
  user_id text NOT NULL
  hermes_session_id text NOT NULL
  title text
  mode text NOT NULL DEFAULT 'ops_chat'
  status text NOT NULL DEFAULT 'active'
  created_at, updated_at timestamptz

kevin_runs
  id uuid PK
  org_id, user_id text NOT NULL
  session_id uuid FK kevin_sessions
  hermes_run_id text NOT NULL
  client_request_id text NULL
  mode text
  status text NOT NULL
  summary text
  error_message text
  risk_class text
  usage jsonb
  created_at, updated_at timestamptz
  UNIQUE(org_id, client_request_id) WHERE client_request_id IS NOT NULL

kevin_audit_events
  id uuid PK
  org_id text
  user_id text
  run_id uuid NULL
  event_type text NOT NULL
  payload jsonb NOT NULL DEFAULT '{}'
  created_at timestamptz NOT NULL DEFAULT now()

kevin_service_tokens  -- hashed tokens for Kevin → TE callbacks
  id uuid PK
  org_id text NOT NULL
  name text
  token_hash text NOT NULL
  scopes text[] NOT NULL
  expires_at timestamptz
  created_at timestamptz
  revoked_at timestamptz NULL
```

Indexes: `(org_id, created_at DESC)` on runs/audit; `(hermes_run_id)` unique on runs.

---

## 16. Frontend (Kevin Console) — information architecture

Route (Wouter): `/admin/kevin` (ADMIN+)

**Panels:**

1. **Home** — health chip, pending approvals count, last runs  
2. **Chat / Ops** — message composer, SSE transcript, inline approval cards  
3. **Approvals** — unified inbox  
4. **Runs** — table + detail drawer  
5. **Sessions** — history  
6. **Agent map** — TE agents (Atlas…) vs Kevin host status (read-only links into existing admin pages)

UI stack: existing React + TanStack Query + shadcn. Streaming via `fetch` ReadableStream helper (shared with any future Atlas improvements).

**Empty/degraded states:** unconfigured secrets; Hermes down; no permission.

---

## 17. Integration with existing TE Hermes Learning

Do **not** rename or replace:

- `hermes-service.ts` / `hermes-learning-service.ts` / `hermes-recommendation-engine.ts`

Clarify naming in UI:

| Name in UI | System |
|------------|--------|
| **Kevin** | External Hermes Agent orchestrator |
| **Learning Engine** | In-app outcome learning (existing “Hermes Learning”) |

Kevin may **read** Learning Engine stats via TE service token scopes and **recommend** promotions; write path stays approval-gated as today.

Optional later: register Kevin as `actorType` in unified action log via a new identity **only if** product wants Kevin actions in the same telemetry — e.g. `platform_ops_agent` / display **Kevin**. Requires explicit product decision (Phase 3).

---

## 18. Incremental implementation phases (risk-minimized)

### Phase 0 — Foundations — **DONE 2026-07-13 (this host)**

**Objective:** Wire private co