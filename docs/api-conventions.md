---
Document Type: Implementation
Verification Status: Verified Against Source
Last Reviewed: 2026-06-28
Owner: Engineering
---

# API Conventions Reference

The conventions governing the TrainEfficiency HTTP API: route registration, URL
naming, the authentication/authorization/organization-resolution middleware chain,
request validation, response and error shapes, status codes, pagination, webhooks,
Server-Sent Events (SSE), idempotency, and rate limiting. All entries are derived
directly from repository source — file paths, function names, status codes, and JSON
shapes are copied as they appear in code.

---

## Document Status

This is the fifth Version 2 implementation document, following `docs/schema.md`,
`docs/core-services.md`, `docs/agent-catalog.md`, and `docs/integrations.md`. It
documents the API surface as of 2026-06-28: an Express 5 backend with ~71 route
modules registered through a single `registerRoutes()` orchestrator.

> **Honest framing:** the API layer has grown organically. Several conventions
> (auth middleware, response/error shapes, validation) are **followed in practice but
> not centrally enforced** — multiple equivalent helpers coexist. This document
> records what is *actually* in the code, and flags the divergences under
> [Architecture Discrepancies](#architecture-discrepancies) rather than presenting an
> idealized version.

---

## Purpose

Give contributors a single reference for how to add or modify an HTTP endpoint
consistently with the existing codebase: where to register it, how to protect it, how
to validate input, and what to return.

---

## Responsibilities

- Document route registration and the Express middleware order
- Document URL/path naming conventions and the `/api/` prefix rule
- Document the auth, authorization, and org-resolution middleware (definitions, not
  just usage) and the canonical protected-route lifecycle
- Document request validation, response shapes, error shapes, and status codes
- Document webhook, SSE, idempotency, and rate-limiting conventions

---

## Does NOT Own

- The OIDC/session implementation itself — covered in `docs/integrations.md` (Replit
  Auth) and `CLAUDE.md` (Authentication, Authorization & Organization Resolution)
- Per-integration webhook *business logic* — covered in `docs/integrations.md`
- Table/column definitions referenced here (`sessions`, `org_sessions`,
  `user_profiles`, `auth_tokens`, `stripe_webhook_events`) — covered in
  `docs/schema.md`
- Service-layer logic invoked by routes — covered in `docs/core-services.md`

---

## Architecture

### Server bootstrap and middleware order

**Source:** `server/index.ts`, `server/routes.ts`, `server/static.ts`,
`server/vite.ts`.

The Express app and HTTP server are created in `server/index.ts`. Middleware is
registered in a **deliberate order** — the Stripe webhook (which needs the raw body
for signature verification) is mounted *before* the JSON body parser:

1. `POST /api/stripe/webhook` with `express.raw({ type: 'application/json' })`
   (registered before JSON parsing).
2. `express.json({ verify: (req,_res,buf) => { req.rawBody = buf } })` — parses JSON
   and stashes the raw Buffer on `req.rawBody` for any later signature checks.
3. `express.urlencoded({ extended: true })`.
4. Request-logging middleware (captures method, path, status, duration for `/api`
   paths).
5. `await registerRoutes(httpServer, app)` — registers all route modules.
6. `orgErrorMiddleware` — converts `OrgResolutionError` into a 403 response.
7. Global error handler `app.use((err, _req, res, next) => …)` — **must be last** in
   the chain; returns `{ message }` with `err.status || err.statusCode || 500`.
8. Static serving: `serveStatic(app)` (production, `server/static.ts`) or
   `setupVite(server, app)` (development, `server/vite.ts`), each with a `/{*path}`
   catch-all serving `index.html` for client-side routing.
9. `httpServer.listen({ port: process.env.PORT || 5000, host: "0.0.0.0", reusePort: true })`.

### Route registration

**Source:** `server/routes.ts` — `export async function registerRoutes(httpServer, app)`.

`registerRoutes()` is a single large async function that **dynamically imports** each
of the ~71 route modules and calls its `registerXRoutes(app)` export, e.g.:

```ts
const { registerPrTrackerRoutes } = await import("./pr-tracker-routes");
registerPrTrackerRoutes(app);
```

Each module follows the same shape:

```ts
export function registerActivityRoutes(app: Express) {
  app.get("/api/org/activity/events", requireAuth, async (req: any, res) => { … });
  // …more routes
}
```

`server/routes.ts` is very large (~31.5k lines) because, in addition to wiring the
modules, it inlines many one-off handlers and defines shared route-layer helpers
(including `requireRole` and `getUserRole`). The modular `registerXRoutes` pattern is
the intended convention for new endpoints.

---

## Components

### 1. URL naming conventions

- **`/api/` prefix is universal.** Every API endpoint is under `/api/`. The only
  non-`/api` route is the `GET /healthz` health check. The catch-all `/{*path}` serves
  the SPA.
- **No API versioning.** Endpoints are flat under `/api/` — there is no `/api/v1/`
  scheme. (The only `/api/v2/` string in the repo is the *external* Replit Connectors
  URL, not an internal route.)
- **kebab-case** for multi-word path segments (`/api/pr-tracker/...`,
  `/api/coach-command-center/...`).
- **Org/role path families:**
  - `/api/org/...` — org-scoped resources (orgId resolved from the session, not the path)
  - `/api/admin/...` — admin-gated operations
  - `/api/coach/...` , `/api/athletic/...` — coach/athletic operations
  - `/api/public/...` — unauthenticated (lead capture, public org pages); rate-limited
  - `/api/org-auth/...`, `/api/auth/...` — auth flows

Representative real endpoints:

| Method | Path |
|---|---|
| GET | `/api/coaches` (public, rate-limited) |
| GET | `/api/availability` (public, rate-limited) |
| GET | `/api/org/activity/events` |
| POST | `/api/pr-tracker/entries` |
| GET | `/api/org/coach/teams` |
| GET | `/api/org/athlete-profile/:userId` |
| POST | `/api/org/nutrition/modules/:moduleId/quiz` |
| GET | `/api/composio/calendar/calendars` |
| POST | `/api/public/lead-capture/:orgSlug/:programSlug` |
| POST | `/api/stripe/webhook` |

### 2. Authentication & authorization middleware

The platform enforces auth **server-side** on protected routes, but the mechanism is
**not centralized into a single middleware** — several equivalent helpers coexist.
The verified set:

| Helper | Defined in | Behavior | Failure |
|---|---|---|---|
| `isAuthenticated` | `server/replit_integrations/auth/replitAuth.ts` | Validates `Authorization: Bearer <token>` (via `auth_tokens`) **or** the OIDC session; refreshes expired tokens; attaches `req.user = { claims: { sub } }` | 401 `{ message: "Unauthorized" }` |
| `requireRole(...roles)` | `server/routes.ts` (**not exported**) | Reads role via `getUserRole(userId)` (→ `user_profiles.role`, default `CLIENT`); checks membership in `roles` | 401 `{ message: "Unauthorized" }` / 403 `{ message: "Forbidden" }` |
| `requireAdmin` | *local helper re-declared per route file* (e.g. `execution-routes.ts`, `email-audit-routes.ts`) | Returns a boolean checked inline; verifies a session exists | 401 `{ message }` or `{ error }` (**inconsistent body**) |
| `privilegedOnly` | `server/scheduling-intelligence-routes.ts` | Auth + role ∈ {ADMIN, COACH, STAFF}; attaches `req._authProfile = { userId, orgId, role }` | 401 / 403 |
| `requireCoach` / `requireOrgUser` | `server/org-auth.ts` | Org-membership gate; attaches `req._orgAuth = { userId, orgId, role }` | 401 / 403 |
| `requireAuth` | *per-module* | Resolves the profile from DB and attaches `req._profile` (with `organizationId`, `role`) | 401 |
| `publicRateLimiter(max, windowMs, label)` | `server/middleware/public-rate-limiter.ts` | In-memory token-bucket for public endpoints | 429 `{ error: "Too many requests…" }` |

> **`requireRole` is defined in `server/routes.ts` and is NOT exported.** External
> route files therefore declare a **local `requireAdmin`** helper — and these locals
> differ (some return `{ message }`, some `{ error }`). This is a known
> inconsistency, now noted in `CLAUDE.md`.

**Roles.** Platform roles are a pg enum `user_role`: `CLIENT | COACH | ADMIN | STAFF`
(`shared/schema.ts`), stored in `user_profiles.role`. Org-membership roles
(`org_memberships.role`) are a separate vocabulary (`athlete | coach | admin | staff |
owner`). Auth guards read `role` and `organization_id` from `user_profiles`, **not**
from `users` (the `users` table has no `organization_id`).

### 3. Organization resolution & multi-tenant isolation

| Resolver | Defined in | Returns | On failure |
|---|---|---|---|
| `resolveOrgIdOrThrow(req)` | `server/lib/resolve-org-id.ts` | Guaranteed non-empty `orgId` (delegates to `resolveOrgSession`, then `user_profiles`/`coach_profiles`) | throws `OrgResolutionError` → 403 `{ error: "ORG_RESOLUTION_FAILED", message }`; logs `ORG_ACCESS_DENIED` |
| `resolveOrgSession(req)` | `server/org-auth.ts` | `{ userId, orgId, role } \| null` (X-Org-Auth-Token → `org_sessions`; OIDC session; Bearer token) | returns `null` |
| `resolveOrgFromInbox(toEmail)` | `server/services/agentmail-inbound-router.ts` | `orgId \| null` (inbound mail routing) | returns `null` |
| `resolveOrgTimezone(org)` | `server/routes.ts` | `org.timezone` or `"America/New_York"` | never fails |

`resolveOrgIdOrThrow()` is the **canonical** resolver for new protected routes because
it never returns an empty string and fails closed (403). The resolved `orgId` is then
passed to service functions, which filter every query by `org_id` — multi-tenant
isolation is enforced at the service/SQL layer, never via the frontend. This confirms
`CLAUDE.md` ADR-002 (*Multi-Tenant by Design*).

### 4. Canonical protected-route lifecycle

The intended chain (matching `CLAUDE.md`'s Route Design lifecycle) is:

```
isAuthenticated  →  requireRole(...)  →  resolveOrgIdOrThrow(req)  →  validate (zod)  →  handler  →  res.json(...)
```

Verified example (`server/composio-calendar-routes.ts`):

```ts
app.get("/api/composio/calendar/calendars",
  isAuthenticated,
  requireRole("COACH", "ADMIN"),
  async (req: any, res) => {
    const orgId = await resolveOrgIdOrThrow(req);
    const result = await executeComposioAction({ orgId, agentId: "scheduling_agent", … });
    res.json({ success: true, calendars, count: calendars.length });
  });
```

In practice the order varies: some routes authorize before resolving org; `privilegedOnly`
bundles authenticate + authorize + org-resolution into one middleware.

### 5. Request validation

- **Zod is the validation tool**, used **inline per route** — there is no shared
  validation middleware. Both `.safeParse()` (preferred) and `.parse()` (throws into
  the route's try/catch) appear.
- `drizzle-zod` `createInsertSchema(...)` schemas exist in `shared/schema.ts` but are
  generally **not** used directly for request validation; route schemas are hand-written
  inline.
- Validation failure → **400**, with either `{ message: "<first error>" }` or
  `{ message: "Invalid request", errors: <zodError.errors> }` (both forms occur).

```ts
const bodySchema = z.object({ apiKey: z.string().min(1), apiBaseUrl: z.string().url() });
const parsed = bodySchema.safeParse(req.body);
if (!parsed.success) return res.status(400).json({ message: "Invalid request", errors: parsed.error.errors });
```

### 6. Response shapes

- **No global success envelope.** Routes return bare JSON via Express `res.json()`.
  Common shapes: `{ <resource>: … }` (e.g. `{ watchlists: [...] }`), multi-property
  objects (e.g. `{ user, membership, org, stats }`), or `{ success: true }`. There is
  **no shared response-builder helper**.
- Collection endpoints often include a `total`: `res.json({ events, grouped, total })`.

### 7. Error shapes & central handler

- **Central error handler** (`server/index.ts`): returns
  `res.status(err.status || err.statusCode || 500).json({ message })`. Logs the error;
  forwards to `next(err)` if headers already sent.
- **Org-resolution handler** (`orgErrorMiddleware` / `handleOrgError`): 403
  `{ error: "ORG_RESOLUTION_FAILED", message: "Forbidden: organization could not be
  determined for this session." }`.
- **Route-level** errors are mostly `{ message: "…" }`; a minority use
  `{ error: "…" }`. The dominant convention is **`{ message }`**.

### 8. HTTP status codes

Observed across all route files (approx. frequency from grep):

| Code | Meaning in this codebase | Approx. count |
|---|---|---|
| 200 | OK (usually implicit) | default |
| 201 | Created (used inconsistently) | ~36 |
| 202 | Accepted — async job queued (e.g. Slack alert request) | ~9 |
| 204 | No content | ~5 |
| 400 | Validation / bad input | ~886 |
| 401 | Unauthenticated | ~144 |
| 403 | Unauthorized / org-resolution failure | ~490 |
| 404 | Resource not found | ~359 |
| 409 | Conflict (e.g. email already in use) | ~40 |
| 410 | Gone | ~4 |
| 413 | Payload too large | ~1 |
| 422 | Business-rule rejection (`{ blocked: true, reason }`) | ~3 |
| 429 | Rate limit exceeded | ~3 (+ public limiter) |
| 500 | Server error (`{ message }`) | ~1,685 |
| 502 | Upstream/Composio failure | ~8 |
| 503 | Dependency unavailable (e.g. integration unconfigured) | ~10 |

### 9. Pagination

- **limit/offset**, query-string based. No cursor pagination, no `page` param.
- Defaults ~50–100, **capped** (`Math.min(parseInt(limit), 100|200)`).
- Responses typically include `total` for client-side math; no standard `hasMore`/`nextOffset`.

```ts
limit: Math.min(parseInt(qLimit ?? "100"), 200),
offset: parseInt(qOffset ?? "0"),
```

### 10. Webhooks

| Route | Raw body | Verification | Idempotency | Response |
|---|---|---|---|---|
| `POST /api/stripe/webhook` | `express.raw` (before json) | `stripe-signature` → `constructEvent()` | `stripe_webhook_events` UNIQUE `stripe_event_id` | fast 200 `{ received: true }` |
| `POST /api/stripe/marketplace-webhook` | parsed JSON | `STRIPE_MARKETPLACE_WEBHOOK_SECRET` | application-level | 200 `{ received: true, type }` |
| `POST /api/agentmail/webhook` | parsed JSON | HMAC `x-agentmail-signature` | `provider_message_id` dedup | 200 `{ received: true, routed }` |
| `POST /api/webhooks/sendgrid-inbound` | urlencoded | optional `?token=SENDGRID_INBOUND_SECRET` | prospect/status check | **fast 200, then fire-and-forget** processing |
| `POST /api/twilio/sms/incoming` | urlencoded | (Twilio inbound) | STOP/START handling | 200 |

**Convention:** verify signature/secret → respond **200 quickly** → process. Structural
failures (missing signature, bad body) return 400/500; business failures still return
200 to prevent provider retries.

### 11. Server-Sent Events (SSE)

Streaming endpoints (e.g. the CEO orchestrator route consuming
`server/ceo-agent-orchestrator.ts`'s `AsyncGenerator<string>`, and
`server/replit_integrations/chat/routes.ts`) follow a consistent convention:

- Headers: `Content-Type: text/event-stream`, `Cache-Control: no-cache`,
  `Connection: keep-alive`, often `X-Accel-Buffering: no` (disable proxy buffering).
- Framing: `res.write("data: " + JSON.stringify(chunk) + "\n\n")` per token, consumed
  via `for await (const chunk of generator)`.
- Termination: a `[DONE]` marker or `{ done: true }` frame, then `res.end()`.
- If an error occurs after headers are sent, it is emitted as an SSE frame rather than
  an HTTP error.

> The orchestrator's `runOrchestrator` is intentionally a **non-async** function
> returning an `AsyncGenerator` directly (making it `async` would break streaming).

### 12. Idempotency

A consistent pattern of **DB UNIQUE constraint + application-level fallback query**:

| Surface | Key | Enforcement |
|---|---|---|
| Stripe webhooks | `stripe_webhook_events.stripe_event_id` | `checkAndInsertWebhookEvent()` insert-then-recover |
| Wallet credits | `wallet_transactions.idempotency_key` / `stripe_payment_intent_id` | `onConflictDoNothing()` |
| Integration actions | `integration_execution_log.idempotency_key` | check before executor (`integration-runtime.ts`) |
| Workflow jobs | `workflow_jobs.idempotency_key` | UNIQUE index; catch PG `23505` |

### 13. Rate limiting

- **No global HTTP rate-limit middleware** (no `express-rate-limit`).
- A **custom per-route limiter** `publicRateLimiter(max, windowMs, label)`
  (`server/middleware/public-rate-limiter.ts`) protects specific public endpoints —
  e.g. `/api/coaches` (120/min), `/api/availability` (60/min), `/api/services` (60/min)
  — returning 429 on excess.
- Provider/integration rate limits are handled separately at the integration-runtime
  layer (`rate_limited` error class, `rate_limit_state`, backoff) — see
  `docs/integrations.md`.

### 14. Async / fire-and-forget

Some endpoints return immediately and continue work in the background — e.g. the
SendGrid inbound webhook responds 200 then processes asynchronously, and the lead
intake pipeline (`docs/core-services.md`) returns before AI processing completes.
Fire-and-forget logging uses dynamic import + `.catch(() => {})` so it never blocks the
response.

### 15. CORS, headers, body limits

- **No explicit CORS middleware** and no custom security-header middleware in
  `index.ts` / `routes.ts` — these are expected to be handled by the Replit runtime /
  reverse proxy.
- **Body size limits are Express defaults (~100kb)** for `json`, `raw`, and
  `urlencoded` — no explicit `limit` is configured. File uploads go through object
  storage (Uppy → signed URL), not large request bodies.

---

## Data Flow

```
Client request
   │
   ▼
express.raw (stripe webhook only) ──► signature verify ──► fast 200
   │
   ▼ (all other /api routes)
express.json (captures req.rawBody) → urlencoded → request logger
   │
   ▼
registerRoutes → registerXRoutes module → route handler chain:
   isAuthenticated → requireRole(...) → resolveOrgIdOrThrow → zod validate → handler
   │
   ▼
service layer (orgId in every WHERE) → res.json(bareObject)
   │
   ▼ (on throw)
orgErrorMiddleware (403 ORG_RESOLUTION_FAILED) → global error handler ({ message })
```

---

## Dependencies

### Internal

| Module | Role |
|---|---|
| `server/replit_integrations/auth/replitAuth.ts` | `isAuthenticated`, OIDC session |
| `server/routes.ts` | `registerRoutes`, `requireRole` (unexported), `getUserRole` |
| `server/org-auth.ts` | `resolveOrgSession`, `requireCoach`, `requireOrgUser` |
| `server/lib/resolve-org-id.ts` | `resolveOrgIdOrThrow`, `OrgResolutionError`, `handleOrgError` |
| `server/middleware/public-rate-limiter.ts` | `publicRateLimiter` |
| `server/index.ts` | middleware order, central error handler, listen |
| `server/static.ts` / `server/vite.ts` | static serving + SPA catch-all |

### External (npm)

`express` (v5), `express-session`, `connect-pg-simple`, `openid-client`, `passport`,
`zod`, `drizzle-zod`. (See `docs/integrations.md` for auth/session detail.)

---

## Security Considerations

**Authentication.** Enforced server-side on protected routes via `isAuthenticated`
(Bearer or OIDC session); never relies on frontend checks.

**Authorization.** Role checks (`requireRole`, `privilegedOnly`, `requireCoach`) read
roles from `user_profiles`/`org_memberships` server-side. 401 = unauthenticated, 403 =
unauthorized/org-resolution failure.

**Tenant isolation.** `resolveOrgIdOrThrow` fails closed (403) and the resolved `orgId`
scopes every downstream query; `ORG_ACCESS_DENIED` is logged on failure.

**Webhooks.** Each verifies a provider signature/secret before acting; Stripe requires
the raw body, enforced by middleware ordering.

**Input.** Zod validates request bodies/queries; the central handler never leaks stack
traces (returns `{ message }`).

---

## Failure Modes

| Failure | Response |
|---|---|
| Missing/invalid auth | 401 `{ message: "Unauthorized" }` |
| Insufficient role | 403 `{ message: "Forbidden" }` (or helper-specific message) |
| Org cannot be resolved | 403 `{ error: "ORG_RESOLUTION_FAILED", message }` |
| Zod validation failure | 400 `{ message }` or `{ message, errors }` |
| Not found | 404 `{ message }` |
| Duplicate/conflict | 409 `{ message }` |
| Unhandled exception | 500 `{ message }` via central handler |
| Public endpoint flooded | 429 `{ error: "Too many requests…" }` |
| Webhook bad signature | 400/500 (business failures still 200 to avoid retries) |

---

## Performance Considerations

- **Pagination caps** (100/200) bound result-set sizes on list endpoints.
- **`publicRateLimiter`** protects unauthenticated endpoints from abuse.
- **SSE** sets `X-Accel-Buffering: no` to stream through proxies without buffering.
- **Fire-and-forget** responses keep webhook/intake latency low.
- **Dynamic `await import()`** of route modules adds minor one-time startup cost but
  keeps the module graph lazy.

---

## Future Improvements

- **Centralize auth middleware.** Consolidate `requireRole` (export it),
  `requireAdmin` (de-duplicate the per-file locals), `privilegedOnly`, and
  `requireCoach` into one shared module with a single failure-body shape. This directly
  supports `CLAUDE.md`'s "Authentication should remain centralized."
- **Standardize response/error envelopes.** Adopt one error shape (`{ message }`) and a
  documented success convention; provide a small `res` helper.
- **Make validation uniform.** Prefer `.safeParse()` everywhere and a single 400 error
  shape; consider a thin validation middleware.
- **Decide on API versioning** before any breaking change (currently unversioned),
  consistent with `CLAUDE.md`'s "Avoid breaking APIs."
- **Set explicit body-size limits** where large payloads are possible.

---

## Related Documentation

- `CLAUDE.md` — Authentication, Authorization & Organization Resolution; Route Design
  lifecycle; Public APIs
- `docs/integrations.md` — Replit Auth (OIDC), webhook signature mechanisms,
  integration-runtime idempotency/rate-limit
- `docs/core-services.md` — services invoked by routes; non-blocking lead intake
- `docs/schema.md` — `sessions`, `org_sessions`, `user_profiles`, `auth_tokens`,
  `stripe_webhook_events`, `wallet_transactions`

---

## Architecture Discrepancies

Differences between repository source and `CLAUDE.md`:

1. **Authentication is not centralized, contrary to `CLAUDE.md`.** The *Authentication
   & Identity* section states "Authentication should remain centralized." In source,
   authorization is spread across `requireRole` (`routes.ts`, unexported),
   per-file local `requireAdmin` helpers (with inconsistent bodies — `{ message }` vs
   `{ error }`), `privilegedOnly` (`scheduling-intelligence-routes.ts`), and
   `requireCoach`/`requireOrgUser` (`org-auth.ts`). Server-side enforcement **is**
   present (the security intent holds), but the *mechanism* is duplicated.

2. **No standard response or error contract.** `CLAUDE.md` (*Public APIs*, *Route
   Design*) implies stable response contracts and error formats, but source has no
   shared envelope: success bodies vary (`{ resource }`, `{ success: true }`,
   multi-property), and error bodies are mostly `{ message }` with a minority of
   `{ error }`. The de-facto error standard is `{ message }`.

3. **No API versioning.** `CLAUDE.md` emphasizes "Avoid breaking APIs" and version
   compatibility, but endpoints are flat under `/api/` with no version segment.

4. **Validation is inline and inconsistent.** Both `.safeParse()` (returns 400
   explicitly) and `.parse()` (throws to try/catch) are used; the 400 body shape
   differs between routes. `CLAUDE.md`'s lifecycle implies a uniform validation step.

5. **`requireRole` is not exported** (confirms the `agent-catalog.md` finding, now in
   `CLAUDE.md`). External route files must re-declare a local `requireAdmin`.

6. **Confirmations (no conflict).** Multi-tenant isolation via org-scoped queries and
   `resolveOrgIdOrThrow` failing closed **confirms** ADR-002 and the
   "organization-scoped queries" principle. The route lifecycle (authenticate → resolve
   org → authorize → validate → execute) is broadly followed.

---

## Recommended CLAUDE.md Updates

Concrete, actionable edits (to apply in a later reconciliation pass, with approval):

1. **Add an "API Conventions" pointer** under *Authentication, Authorization &
   Organization Resolution* (or *Public APIs*) summarizing the canonical chain
   (`isAuthenticated → requireRole → resolveOrgIdOrThrow → zod → handler`) and naming
   `server/lib/resolve-org-id.ts` as the canonical org resolver. Defer detail to
   `docs/api-conventions.md`.

2. **Record the de-facto standards** so new code converges: `/api/` prefix, no
   versioning, `{ message }` error body, limit/offset pagination with caps, and the
   "verify → fast 200 → process" webhook rule.

3. **Acknowledge the centralization gap** as known technical debt: multiple auth
   helpers and response shapes coexist; new routes should prefer `isAuthenticated` +
   `requireRole` + `resolveOrgIdOrThrow` and the `{ message }` error shape until a
   shared module exists.

4. **Note SSE and idempotency conventions** as platform standards (text/event-stream
   framing with `[DONE]`; DB-UNIQUE-plus-fallback idempotency).

These are recommendations only — no `CLAUDE.md` edits are applied by this document.

---

## Files Reviewed

| File | Notes |
|---|---|
| `server/index.ts` | Middleware order, raw-body capture, central error handler, listen, static/vite wiring |
| `server/routes.ts` | `registerRoutes`, module registration, `requireRole` (unexported), `getUserRole`, `resolveOrgTimezone`, SSE + SendGrid inbound |
| `server/replit_integrations/auth/replitAuth.ts` | `isAuthenticated`, Bearer + OIDC session |
| `server/org-auth.ts` | `resolveOrgSession`, `requireCoach`, `requireOrgUser`, `OrgAuthContext` |
| `server/lib/resolve-org-id.ts` | `resolveOrgIdOrThrow`, `OrgResolutionError`, `handleOrgError`, `logOrgAccessDenied` |
| `server/scheduling-intelligence-routes.ts` | `privilegedOnly` definition |
| `server/execution-routes.ts`, `server/email-audit-routes.ts` | Local `requireAdmin` helper variants |
| `server/middleware/public-rate-limiter.ts` | `publicRateLimiter` definition + usage |
| `server/activity-routes.ts`, `pr-tracker-routes.ts`, `nutrition-routes.ts`, `org-profile-routes.ts`, `intelligence-routes.ts`, `integrations-routes.ts`, `composio-calendar-routes.ts` | Representative route/validation/response/pagination examples |
| `server/static.ts`, `server/vite.ts` | Static serving + `/{*path}` SPA catch-all |
| `server/webhookHandlers.ts`, `server/phase10-routes.ts`, `server/agentmail-routes.ts` | Webhook conventions + idempotency |
| `server/ceo-agent-orchestrator.ts`, `server/replit_integrations/chat/routes.ts` | SSE streaming conventions |
| `server/integration-runtime.ts`, `server/workflow-job-queue.ts`, `server/storage.ts` | Idempotency + rate-limit-state patterns |
| `shared/schema.ts` | `user_role` enum, org-membership roles, insert schemas |
| `docs/_template.md`, `docs/documentation-status-legend.md`, `docs/version-2-roadmap.md` | Structure/compliance |
| `docs/schema.md`, `docs/core-services.md`, `docs/agent-catalog.md`, `docs/integrations.md` | Cross-reference |

**Verification methods:** route-file inventory (`ls`, grep for `registerXRoutes`);
middleware-usage frequency (`grep` for `isAuthenticated|requireRole|resolveOrg*`);
status-code frequency grep; direct reads of definitions (not just usages); and
negative confirmations for `requireRole` export (absent), global rate-limit middleware
(absent), and internal API versioning (absent — the only `/api/v2/` is the external
Replit Connectors URL).

---

## Confidence Assessment

**Overall confidence: High.**

- **Verified (High):** middleware order, route registration mechanism, the `/api/`
  prefix rule, auth/authorization/org-resolution helper definitions, the central error
  handler, webhook conventions, SSE framing, idempotency keys, and the
  `publicRateLimiter` — all read directly from source.
- **Verified-negative (High):** no internal API versioning, no global rate-limit
  middleware, `requireRole` not exported — confirmed by targeted grep.

**Limits on confidence:**
- `server/routes.ts` is ~31.5k lines; representative handlers were sampled rather than
  exhaustively enumerated. The *conventions* are confirmed, but a specific endpoint may
  deviate (the inconsistency itself is documented).
- Status-code counts are grep approximations across route files, used to characterize
  prevalence, not as exact totals.
- Some line numbers in supporting analysis came from agent-assisted reads; file paths,
  function names, helper signatures, and JSON shapes were the primary citation basis
  and are stable.

---

## Last Updated

Date: 2026-06-28

Author: Engineering (generated from source — Verified Against Source)

Version: 1.0
