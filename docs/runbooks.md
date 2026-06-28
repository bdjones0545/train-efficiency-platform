---
Document Type: Operations
Verification Status: Partially Verified
Last Reviewed: 2026-06-28
Owner: Engineering
---

# Operations Runbooks

Operational runbooks for running, deploying, monitoring, and recovering the
TrainEfficiency platform. This is an **Operations** document: it mixes facts derived
from repository source with procedures that can only be confirmed against the live
production system.

---

## Document Status

This is the sixth and final Version 2 implementation/operations document, following
`docs/schema.md`, `docs/core-services.md`, `docs/agent-catalog.md`,
`docs/integrations.md`, and `docs/api-conventions.md`.

**Verification Status: Partially Verified.** Per `docs/documentation-status-legend.md`,
an Operations document progresses toward `Verified Against Production` once validated
against the live system. This document was authored **without production access**, so:

- Configuration, startup sequence, build, cron wiring, and code-level behavior are
  **Verified Against Source**.
- Anything describing live-environment behavior (actual deploy pipeline, real
  monitoring dashboards, on-call process, backup cadence) is **Requires Production
  Validation** and is not asserted as fact.

### Verification Tags

Every runbook section is tagged with one or more of:

| Tag | Meaning |
|---|---|
| **[VS] Verified Against Source** | Confirmed by reading repository files (cited) |
| **[VP] Verified Against Production** | Confirmed against the live system — **none in this document** (no production access at authoring time) |
| **[OR] Operational Recommendation** | Sensible practice consistent with the code, but not itself a repository fact |
| **[RPV] Requires Production Validation** | Production-only behavior that cannot be confirmed from the repository |

> No section is tagged **[VP]**. Promoting this document to `Verified Against
> Production` requires an operator to confirm the **[RPV]** items against the live
> environment and re-tag them.

---

## Purpose

Give an operator the procedures needed to deploy, observe, and recover
TrainEfficiency, grounded in what the repository actually implements — and to make
explicit where production validation is still required.

---

## Responsibilities

- Document the deployment configuration and build pipeline
- Document the exact startup sequence and the scheduled-job (cron) inventory
- Document database migration, backup/recovery posture
- Document monitoring, logging, and health-check surfaces
- Document incident-response and recovery procedures for critical subsystems
- Document local development setup and a production-readiness checklist
- Explicitly flag production-only behavior as **[RPV]**

---

## Does NOT Own

- Subsystem internals (services, agents, integrations) — covered in
  `docs/core-services.md`, `docs/agent-catalog.md`, `docs/integrations.md`
- Table definitions — covered in `docs/schema.md`
- API request/response conventions — covered in `docs/api-conventions.md`
- The intended architecture and engineering philosophy — covered in `CLAUDE.md`

---

## Architecture (Operational View)

**[VS]** Sources: `.replit`, `package.json`, `script/build.ts`, `server/index.ts`,
`drizzle.config.ts`.

- **Runtime:** Node.js 20, single Express 5 process serving both the API and the
  built React client. PostgreSQL 16 is the system of record.
- **Hosting:** Replit. `.replit` declares `deploymentTarget = "autoscale"`, build
  `npm run build`, run `node dist/index.cjs`, `publicDir = "dist/public"`, and maps
  `localPort 5000 → externalPort 80`.
- **Process model:** One web process. All background work (crons, agents, heartbeat)
  runs **in-process** via `setInterval`/`setTimeout` started during boot — there is no
  separate worker tier or external scheduler.
- **Listen:** `httpServer.listen({ port: process.env.PORT || 5000, host: "0.0.0.0",
  reusePort: true })`.

> **[RPV]** Whether production actually runs on Replit Autoscale (vs. another target),
> the number of instances, and autoscale thresholds must be confirmed against the live
> deployment. Note the in-process scheduler model means **multiple instances would run
> duplicate crons** unless guarded — see [Scheduled Jobs](#scheduled-jobs--cron-services).

---

## Components / Runbooks

### 1. Deployment

**[VS]** Source: `.replit`, `package.json`, `script/build.ts`.

Build and run commands:

| Step | Command | Source |
|---|---|---|
| Build | `npm run build` → `tsx script/build.ts` | `package.json`, `.replit` |
| Start (prod) | `node dist/index.cjs` (`NODE_ENV=production`) | `.replit`, `package.json` `start` |
| Dev | `npm run dev` → `tsx server/index.ts` (`NODE_ENV=development`) | `package.json` |
| Typecheck | `npm run check` → `tsc` | `package.json` |

The build (`script/build.ts`) **typechecks the client first (`tsc --noEmit -p
tsconfig.client.json`) and aborts on any error**, then builds the client with Vite and
bundles the server with esbuild to `dist/index.cjs` (CJS, minified, `NODE_ENV` inlined
to `"production"`). A dependency allowlist is bundled (rest kept external) to reduce
cold-start syscalls.

**Deploy procedure (derived):**
1. Ensure all required environment variables/secrets are set (see
   [Production Readiness Checklist](#production-readiness-checklist)).
2. `npm run build` — fails closed on TypeScript errors.
3. Start `node dist/index.cjs`.
4. Confirm `GET /healthz` returns healthy (see [Monitoring](#monitoring)).

> **[RPV]** The actual production deploy trigger (Replit "Deploy" button, autoscale
> rollout, zero-downtime behavior, rollback mechanism) is not defined in the
> repository and must be validated operationally.
> **[OR]** Run `npm run check` and `npm run build` in CI before any deploy, since the
> build already gates on typecheck.

---

### 2. Startup Sequence

**[VS]** Source: `server/index.ts` (read in full).

Order of operations at boot:

1. **Stripe webhook route registered first** — `POST /api/stripe/webhook` with
   `express.raw({ type: 'application/json' })`, **before** the JSON body parser, so the
   raw body is available for signature verification.
2. **Body parsing** — `express.json({ verify })` (captures `req.rawBody`),
   `express.urlencoded`.
3. **Request logging middleware** — logs method/path/status/duration for `/api` paths.
4. **Async bootstrap IIFE begins:**
   1. **Seeds** — `seedDatabase()` (dev only; skipped when `NODE_ENV=production`),
      then `seedDefaultEducationLibrary()` (always; idempotent).
   2. **Action-tracking intervals** — outcome detection (30 min) and auto-send/campaign
      engine (30 min, gated by per-org `automationLevel`).
   3. **Pending-actions cleanup** (15 min + once at startup).
   4. **Recurring team-lead research** (hourly).
   5. **Financial event retry cron** (15 min).
   6. **Athlete context refresh** (24 h; first run 5 min after startup).
   7. **Intervention outcome evaluation** (6 h).
   8. **Organization Intelligence Orchestrator** — `initializeOrchestrator()`.
   9. **Daily Operations Engine** (6 h; first run 8 min after startup).
   10. **Daily revenue opportunity sync** (24 h; first run 60 s after startup).
   11. **Lead recovery cron** — `startLeadRecoveryCron(15 min)`.
   12. **Autonomy action executor** — `startActionExecutor()`.
   13. **Workflow runners** — `startWorkflowRunner()`, `startWorkflowJobRunner()`.
   14. **CEO Heartbeat** — `startCeoHeartbeat()` (30-min cycle).
   15. **Agents** — `startApexDailyCron()`, `startPulseDailyCron()`.
   16. **`registerRoutes(httpServer, app)`** — all ~71 route modules.
   17. **AI infrastructure backfill** — `backfillAllOrgsAiInfrastructure()`.
   18. **Attendance report cron** — `startAttendanceReportCron()`.
   19. **Gmail hourly sync** — `startGmailSyncCron()`.
   20. **Obsidian sync** — `startObsidianSyncCron()`.
   21. **Static/dev serving** — `serveStatic(app)` (prod) or `setupVite(...)` (dev).
   22. **Listen** on `PORT` (default 5000).

> **Ordering note [VS]:** Several agent tables self-provision before first use (e.g.
> `apex_recommendations`, `pulse_recommendations` via `ensureTable()`); `startApex/Pulse`
> run before the first CEO Heartbeat cycle so those tables exist when queried (see
> `docs/agent-catalog.md`, Failure Modes).

---

### 3. Scheduled Jobs / Cron Services

**[VS]** Source: `server/index.ts` and the referenced service modules.

| Job | Interval | First run | Started by |
|---|---|---|---|
| Outcome detection | 30 min | immediate | `setInterval` (index.ts) |
| Auto-send / campaign engine | 30 min | immediate | `setInterval` (index.ts) |
| Pending-actions cleanup | 15 min | at startup | `setInterval` + once |
| Recurring team-lead research | 60 min | immediate | `setInterval` |
| Financial event retry | 15 min | immediate | `setInterval` |
| Athlete context refresh | 24 h | +5 min | `setInterval` + `setTimeout` |
| Intervention outcome eval | 6 h | immediate | `setInterval` |
| Daily Operations Engine | 6 h | +8 min | `setInterval` + `setTimeout` |
| Daily revenue sync | 24 h | +60 s | `setInterval` + `setTimeout` |
| Lead recovery | 15 min | per service | `startLeadRecoveryCron` |
| Action executor | per service | per service | `startActionExecutor` |
| Workflow runner / job runner | per service | per service | `startWorkflowRunner/JobRunner` |
| CEO Heartbeat | 30 min | per service | `startCeoHeartbeat` |
| Apex (growth) | daily | per service | `startApexDailyCron` |
| Pulse (retention) | daily | per service | `startPulseDailyCron` |
| Attendance report | per service | per service | `startAttendanceReportCron` |
| Gmail sync | hourly | per service | `startGmailSyncCron` |
| Obsidian sync | per service | per service | `startObsidianSyncCron` |

**Concurrency safety [VS]:** Per-org work uses distributed job locks
(`acquireJobLock`/`releaseJobLock` in `ceo-heartbeat-service.ts`; `releaseJobLock`
**deletes** the lock row) and global in-flight guards (e.g. `followUpCronIsRunning`,
`dailyJobRunning`). See `docs/core-services.md` and `docs/agent-catalog.md`.

> **[RPV] Multi-instance risk:** Because crons start in every process, running more
> than one instance (e.g. autoscale > 1) would double-fire any job **not** protected by
> a DB job lock. Confirm production instance count and which jobs are lock-guarded
> before scaling out.
> **[OR]** If horizontal scaling is needed, gate all `setInterval` crons behind a
> shared DB lock (the heartbeat pattern already exists) or move them to a single
> leader/worker.

---

### 4. Database & Migrations

**[VS]** Source: `drizzle.config.ts`, `package.json`, `shared/schema.ts`,
`docs/schema.md`.

- **ORM:** Drizzle over PostgreSQL. Schema at `shared/schema.ts` (208 Drizzle tables);
  `drizzle.config.ts` sets `out: "./migrations"`, `dialect: "postgresql"`,
  `url: DATABASE_URL`.
- **Migration model is push-based:** the only DB script is `db:push` (`drizzle-kit
  push`). There is **no committed migration-file history** (the `migrations/` output
  directory is empty in the repo). Schema changes are applied by diffing
  `shared/schema.ts` against the live database.
- **~20 raw-SQL tables** are created at runtime via `db.execute()` / `ensureTable()`
  in service files (e.g. `apex_recommendations`, `pulse_recommendations`,
  `hermes_auto_learnings`, forecast tables) and are **outside** the Drizzle graph (see
  `docs/schema.md` Appendix A).

**Apply a schema change (derived):**
1. Edit `shared/schema.ts`.
2. Run `npm run db:push` (`drizzle-kit push`) against the target database.
3. Verify with `npm run check`.

> **[RPV]** `drizzle-kit push` can be destructive on column/table drops. Whether a
> staging database, review step, or snapshot precedes production `push` is **not**
> encoded in the repo and must be validated.
> **[OR]** Treat `db:push` as requiring a manual review of the generated diff and a
> fresh backup beforehand; prefer additive, backwards-compatible changes
> (`CLAUDE.md` Schema Evolution).

---

### 5. Backup & Recovery

> **[RPV] The repository contains no backup configuration, snapshot scripts, or
> point-in-time-recovery (PITR) definitions.** Database backup cadence, retention, and
> restore procedures are provided by the managed Postgres host (Replit/Neon-class) and
> must be confirmed and documented operationally.

What the repository *does* provide for data-integrity recovery **[VS]**:

- **Financial dead-letter + repair:** failed wallet credits land in
  `financial_event_failures` (max 3 attempts); `stripeWalletSyncAudit()` /
  `stripeWalletSyncRepair()` (and platform-wide variants) in `webhookHandlers.ts`
  reconcile ledger vs. Stripe. A standalone `script/stripe-wallet-repair.ts` exists.
- **Idempotent ledgers:** `wallet_transactions.idempotency_key` and
  `stripe_webhook_events.stripe_event_id` are UNIQUE — safe to reprocess.
- **PostgreSQL as system of record** (ADR-007): external services/caches are not
  authoritative, so recovery centers on the database.

> **[OR]** Establish (and record here) a verified restore drill: snapshot → restore to
> scratch DB → run `npm run check` and a smoke test of `/healthz`.

---

### 6. Agent Startup Order

**[VS]** Source: `server/index.ts`, `docs/agent-catalog.md`.

Agents are started in this order during boot: **action executor → workflow runners →
CEO Heartbeat → Apex → Pulse**, then routes, then the AI-infrastructure backfill, then
the Gmail/Obsidian/attendance crons. The Organization Intelligence Orchestrator is
initialized earlier (`initializeOrchestrator()`).

The nine canonical agent identities and the v1→v2 adapter details are in
`docs/agent-catalog.md` / `CLAUDE.md`. Apex/Pulse self-provision their raw-SQL tables
before the heartbeat queries them.

> **[RPV]** Whether all agents are *enabled* in production (per-org governance,
> emergency-pause state, `automationLevel`) is runtime/data-dependent and must be
> checked live.

---

### 7. Email Infrastructure

**[VS]** Source: `server/email.ts`, AgentMail services, `server/index.ts`,
`docs/integrations.md`, `docs/core-services.md`.

- **SendGrid** is the transactional sender; credentials resolve from
  `SENDGRID_API_KEY`/`SENDGRID_FROM_EMAIL` or the Replit `sendgrid` connector.
  `validateEmailProvider()` runs at startup and **warns but does not crash** if
  unconfigured.
- **AgentMail** powers agent inboxes (inbound-only in v0); independent of SendGrid.
- All automated outreach passes the guard chain (autonomy policy → send guard →
  guarded-outbound-email → audit log); see `docs/core-services.md`.
- **Inbound webhooks:** SendGrid Inbound Parse `POST /api/webhooks/sendgrid-inbound`
  (optional `?token=SENDGRID_INBOUND_SECRET`); AgentMail `POST /api/agentmail/webhook`
  (HMAC `x-agentmail-signature`).

**Troubleshooting:**
- *No emails sending:* check `isEmailProviderConfigured()` / startup warning; verify
  `SENDGRID_API_KEY`; check org emergency-pause and daily caps.
- *Inbound replies not processed:* verify the SendGrid/AgentMail webhook URL and secret;
  inbound returns 200 fast then processes asynchronously.

> **[RPV]** SendGrid sender/domain authentication (SPF/DKIM), deliverability, and the
> production webhook URLs are external configuration to validate live.

---

### 8. Stripe Webhooks

**[VS]** Source: `server/index.ts`, `server/webhookHandlers.ts`,
`server/stripeClient.ts`, `docs/integrations.md`.

- **Endpoint:** `POST /api/stripe/webhook` (raw body, registered before JSON parser).
  Signature via `stripe-signature` → `constructEvent()`. Marketplace events:
  `POST /api/stripe/marketplace-webhook` (`STRIPE_MARKETPLACE_WEBHOOK_SECRET`).
- **Idempotency:** `stripe_webhook_events` UNIQUE `stripe_event_id`;
  `checkAndInsertWebhookEvent()` insert-then-recover; failures → `financial_event_failures`.
- **Secret fallback:** if `STRIPE_WEBHOOK_SECRET` is unset, `stripe-replit-sync` falls
  back to the managed-webhook secret stored in the DB (logged as a warning).
- **Response:** fast `200 { received: true }`; structural failures only return 400/500.

**Troubleshooting:**
- *Events not processed:* check `stripe_webhook_events.processed_status`
  (`pending/success/failed/skipped`) and `processing_error`.
- *Wallet not credited:* inspect `financial_event_failures`, then run
  `stripeWalletSyncAudit()` → `stripeWalletSyncRepair(dryRun=true)` before a real repair.

> **[RPV]** The live webhook endpoint registration in the Stripe Dashboard, live vs.
> test mode, and `STRIPE_*` secret values must be confirmed in production.

---

### 9. Meta Pixel / CAPI

**[VS]** Source: `server/meta-capi.ts`, `server/meta-book-capi.ts`,
`client/src/lib/meta-pixel.ts`, `docs/integrations.md`.

- Server CAPI posts to `graph.facebook.com/v19.0/{PIXEL_ID}/events` using
  `META_CAPI_TOKEN`; book funnel uses `META_BOOK_PIXEL_ID`/`META_BOOK_ACCESS_TOKEN`.
  `.replit` sets `META_BOOK_PIXEL_ID` in shared env.
- Browser pixel + server CAPI **deduplicate via a shared `event_id`**; PII is hashed
  (SHA-256) before transmission. Honors org emergency-pause.
- Degrades to `{ sent:false, reason:"secrets_missing" }` when unconfigured.

> **[RPV]** Real pixel IDs/tokens, Events Manager match quality, and dedup correctness
> are verifiable only in Meta's tooling against live traffic.

---

### 10. Gmail Integrations

**[VS]** Source: `server/services/gmail-agent-service.ts`,
`server/services/gmail-sync-state.ts`, `docs/integrations.md`.

- Per-org OAuth credentials in `external_integrations` (AES-256-GCM); scopes
  `gmail.send`, `gmail.readonly`, `gmail.modify`. Tokens auto-refresh via the
  `oauth2Client.on("tokens")` callback (errors logged, not thrown).
- **Hourly sync** (`startGmailSyncCron`) runs `runLeadReplyRecovery`; per-org state in
  `gmail-sync-state` (`idle/running/success/failed/skipped`), 55s job lock.

**Troubleshooting:**
- *Gmail "not connected":* the integration row is missing or `status !== "connected"`
  → re-run the OAuth connect flow.
- *Sync stuck:* check sync `status`/`errorMessage`; a failed run records the error and
  schedules the next attempt.

> **[RPV]** The production Google OAuth app (consent screen, verified scopes, redirect
> URIs) and per-org connection state require live validation.

---

### 11. Authentication

**[VS]** Source: `server/replit_integrations/auth/replitAuth.ts`,
`docs/integrations.md`, `docs/api-conventions.md`.

- Replit OIDC via `openid-client`; issuer `ISSUER_URL` (default
  `https://replit.com/oidc`), client `REPL_ID`, strategy per host in `REPLIT_DOMAINS`.
- Sessions in the `sessions` table via `connect-pg-simple` (`DATABASE_URL`,
  `SESSION_SECRET`), 7-day TTL. `isAuthenticated` also accepts `Authorization: Bearer`
  tokens from `auth_tokens`.

**Troubleshooting:**
- *All logins failing:* verify `REPL_ID`, `ISSUER_URL`, `REPLIT_DOMAINS`,
  `SESSION_SECRET`, and DB reachability (session store).
- *401 on a known-good session:* check token expiry/refresh; the middleware refreshes
  via `refreshTokenGrant`.

> **[RPV]** Production OIDC client registration and domain allow-list are
> environment-specific.

---

### 12. Monitoring

**[VS]** Source: `server/reliability-routes.ts`.

- **Public health check:** `GET /healthz` — lightweight, "safe for uptime monitors."
- **Reliability dashboard:** `GET /api/reliability/dashboard` — aggregated stats.
- **Client/query error capture:** `persistClientError()`, `persistQueryFailure()`,
  and `POST /api/reliability/query-failures`.
- Per-subsystem health endpoints also exist (e.g.
  `/api/communication-intelligence/health`, `/api/departments/health`).

> **[RPV]** External uptime monitors, alerting/paging, metric dashboards, and log
> aggregation/retention are infrastructure concerns not defined in the repository.
> **[OR]** Point an uptime monitor at `/healthz`; alert on non-200 and on growth in
> the reliability dashboard's failure counts.

---

### 13. Logging

**[VS]** Source: `server/index.ts` request logger, `server/reliability-routes.ts`
`logSystemEvent()`, `docs/core-services.md`.

- **Request logs:** method, path, status, duration for `/api` paths (console).
- **Structured system events:** `logSystemEvent(level, source, type, message, …)`
  persists to the system event log; webhook handlers and crons emit these
  fire-and-forget (`.catch(() => {})` so logging never blocks).
- **Integration audit:** every governed integration call writes to
  `integration_execution_log`; outbound email to `outbound_email_audit_log`; org access
  denials emit `ORG_ACCESS_DENIED`.
- **Secrets are never logged** (`CLAUDE.md` Logging standard); credentials are masked
  before reaching the frontend.

> **[RPV]** Log shipping, retention windows, and PII-scrubbing in the production log
> pipeline require operational confirmation.

---

### 14. CEO Heartbeat

**[VS]** Source: `server/services/ceo-heartbeat-service.ts`, `docs/core-services.md`.

- 30-minute orchestration cycle (`HEARTBEAT_INTERVAL_MS = 30 * 60 * 1000`), started at
  boot via `startCeoHeartbeat()`; `pauseCeoHeartbeat()`/`resumeCeoHeartbeat()` control it.
- Uses distributed job locks (`job_execution_locks`); **`releaseJobLock` deletes the
  lock row** — updating to "released" would block the next run within the ~28-minute
  window.
- Status/health via `getHeartbeatStatus()` / `getExecutionHealth(orgId)`; runs recorded
  in `ceo_heartbeat_runs`.

**Troubleshooting:**
- *Heartbeat not running:* check pause sentinel (`_globalPaused` / `job_execution_locks`)
  and `getHeartbeatStatus()`.
- *Apex/Pulse "relation does not exist":* ensure `ensureTable()` ran (startup order) —
  see `docs/agent-catalog.md`.

> **[RPV]** Live heartbeat cadence, per-org pause state, and lock contention are
> runtime conditions to observe in production.

---

### 15. Dead-Letter Handling

**[VS]** Source: `server/services/agent-dead-letter-service.ts`,
`server/webhookHandlers.ts`, `docs/core-services.md`.

- **Agent dead-letter queue:** failed agent actions exceeding retries →
  `pushToDeadLetter()`; inspect via `getDeadLetterJobs()` / `getDeadLetterSummary()`;
  resolve via `markJobResolved()` / `incrementRetryCount()`. Entries store `userId`.
- **Financial dead-letter:** `financial_event_failures` (max 3 attempts) for failed
  wallet credits.
- **Obsidian sync queue:** `requeueFailed()` re-enqueues failed sync items.

**Procedure (derived):**
1. Review dead-letter summary for the affected subsystem.
2. Fix the root cause (credentials, schema, downstream outage).
3. Re-trigger: financial → `stripeWalletSyncRepair`; Obsidian → `requeueFailed`; agent
   jobs → manual re-trigger (no automatic retry of dead-lettered jobs).

> **[RPV]** Operator visibility (admin reliability dashboard) and the manual
> re-trigger workflow should be confirmed live.

---

### 16. Incident Response

> The repository does **not** define an incident-response policy, severity levels, or
> on-call rotation. The steps below are **[OR] Operational Recommendations** built from
> the platform's actual controls; they are **[RPV]** until adopted and validated.

**Global stop (verified control [VS]):** org-level **emergency pause**
(`orgAiGovernanceSettings.emergencyPauseEnabled`) hard-blocks all automated
communication (Twilio, AgentMail, guarded email, Meta CAPI honor it). This is the
fastest way to halt AI/outbound activity for an org without a deploy.

**[OR] Suggested flow:**
1. **Contain:** enable emergency pause for affected org(s); for platform-wide issues,
   `pauseCeoHeartbeat()`.
2. **Diagnose:** `/healthz`, `/api/reliability/dashboard`, system event log,
   `integration_execution_log`, dead-letter summaries.
3. **Isolate by subsystem:** use the relevant troubleshooting runbook above.
4. **Recover:** apply the subsystem recovery (wallet repair, requeue, re-connect OAuth).
5. **Resume:** clear emergency pause / `resumeCeoHeartbeat()`.
6. **Post-incident:** record findings (the Decision Journal / Hermes systems exist for
   institutional memory).

---

### 17. Recovery Procedures (Quick Reference)

| Symptom | First check | Recovery | Tag |
|---|---|---|---|
| Wallet not credited | `financial_event_failures` | `stripeWalletSyncAudit` → `stripeWalletSyncRepair(dryRun)` → repair | [VS] tooling / [RPV] live |
| Webhook events failing | `stripe_webhook_events.processed_status` | fix cause; reprocess (idempotent) | [VS] |
| Agent jobs failing | dead-letter summary | fix cause; manual re-trigger | [VS] tooling |
| Obsidian sync backlog | `getQueueStats()` | `requeueFailed()` | [VS] |
| Gmail disconnected | integration status | re-run OAuth connect | [VS] |
| Heartbeat stalled | `getHeartbeatStatus()` / locks | clear pause; verify lock rows deleted | [VS] |
| All logins failing | auth env vars + DB | restore session store / secrets | [VS] vars / [RPV] live |

---

### 18. Common Troubleshooting

**[VS]** derived from startup checks and `docs/integrations.md` degradation paths.

- **Boot env check:** startup logs `[ENV CHECK] OPENAI_API_KEY exists: …` and a SendGrid
  configuration warning — first signals of missing config.
- **"X not configured":** integrations expose `is*Configured()`; most degrade gracefully
  (return `{ sent:false }` / 503) rather than crash. OpenAI is mixed (some callers throw).
- **503 from an integration route:** the integration is unconfigured for that org.
- **403 `ORG_RESOLUTION_FAILED`:** the session has no resolvable org (see
  `docs/api-conventions.md`).

---

### 19. Local Development Setup

**[VS]** Source: `package.json`, `.replit`, `server/index.ts`, `drizzle.config.ts`.

1. Node.js 20 + a PostgreSQL 16 database; set `DATABASE_URL` (required — `drizzle.config.ts`
   throws without it).
2. Set `SESSION_SECRET` and the OIDC vars (`REPL_ID`, `ISSUER_URL`, `REPLIT_DOMAINS`)
   for auth; optional integration keys (`OPENAI_API_KEY`, `SENDGRID_API_KEY`,
   `STRIPE_SECRET_KEY`, etc.) enable those features — most degrade if absent.
3. `npm install`.
4. `npm run db:push` to sync the schema.
5. `npm run dev` (runs `tsx server/index.ts`, `NODE_ENV=development`). Dev seeds run
   (`seedDatabase()`); Vite middleware serves the client with HMR.
6. App listens on `PORT` (default 5000).

> **[OR]** Run `npm run check` before committing; the production build gates on the
> client typecheck.

---

### 20. Production Readiness Checklist

**[VS]** core list mirrors `CLAUDE.md`'s checklist; environment variables are the
actual `process.env.*` reads found in source.

**Required:**
- [ ] `DATABASE_URL` (app + Drizzle + session store)
- [ ] `SESSION_SECRET`
- [ ] OIDC: `REPL_ID`, `ISSUER_URL`, `REPLIT_DOMAINS`
- [ ] `NODE_ENV=production` (skips dev seed)
- [ ] `CREDENTIAL_ENCRYPTION_KEY` (per-org credential vault; falls back to `SESSION_SECRET`)

**Per enabled integration:**
- [ ] Payments: `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` (or managed fallback),
      `STRIPE_PUBLISHABLE_KEY`; webhook endpoint registered in Stripe
- [ ] AI: `OPENAI_API_KEY` (and/or `AI_INTEGRATIONS_OPENAI_*`, `OPENROUTER_API_KEY`)
- [ ] Email: `SENDGRID_API_KEY`, `SENDGRID_FROM_EMAIL`, `SENDGRID_INBOUND_SECRET`
- [ ] AgentMail: `AGENTMAIL_API_KEY`, `AGENTMAIL_WEBHOOK_SECRET`, `AGENTMAIL_ORG_DOMAIN`
- [ ] SMS: `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_PHONE_NUMBER`
- [ ] Google: `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`
- [ ] Meta: `META_CAPI_TOKEN`, `META_BOOK_PIXEL_ID`, `META_BOOK_ACCESS_TOKEN`
- [ ] Composio: `COMPOSIO_API_KEY`
- [ ] Object storage: `PUBLIC_OBJECT_SEARCH_PATHS`, `PRIVATE_OBJECT_DIR`
- [ ] Optional: `OBSIDIAN_*`, `TRAINCHAT_*`, `INTEGRATION_ENCRYPTION_SECRET`,
      `ADMIN_REPAIR_KEY`

**Process:**
- [ ] `npm run build` passes (gates on client typecheck)
- [ ] `npm run db:push` applied and reviewed against the target DB
- [ ] `GET /healthz` returns healthy after start
- [ ] No dev seed in production (auto-skipped by `NODE_ENV`)

> **[RPV]** Backup/restore drill, monitoring/alerting hookup, multi-instance cron
> safety, and the deploy/rollback mechanism must be validated against production before
> sign-off.

---

## Data Flow (Operational)

```
Deploy: npm run build (typecheck → vite → esbuild) → node dist/index.cjs
   │
   ▼
Boot: raw stripe webhook → body parsers → logger
   │
   ▼ (async bootstrap)
seeds → interval crons → agents (executor→workflows→heartbeat→apex→pulse)
   → registerRoutes → AI backfill → gmail/obsidian/attendance crons → static/vite → listen :PORT
   │
   ▼
Run: /healthz + /api/reliability/dashboard (monitor)
     logSystemEvent + integration_execution_log + audit logs (observe)
     dead-letter queues + emergency pause (contain/recover)
```

---

## Dependencies

**Internal:** `server/index.ts` (bootstrap), `server/reliability-routes.ts`
(health/logging), `ceo-heartbeat-service.ts` (orchestration locks),
`agent-dead-letter-service.ts`, `webhookHandlers.ts` (financial recovery),
`script/build.ts` (build).

**External:** PostgreSQL 16, Node 20, Replit hosting/connectors, and the third-party
providers catalogued in `docs/integrations.md`.

---

## Security Considerations

- **Secrets** live in environment/connectors, never committed; logs must not contain
  them (`CLAUDE.md`).
- **Emergency pause** is the primary operational kill-switch for AI/outbound activity.
- **Tenant isolation** holds in background jobs: crons iterate orgs explicitly and pass
  `orgId` to org-scoped queries.
- **Webhook endpoints** verify provider signatures/secrets before acting.

---

## Failure Modes

| Failure | Operational effect | Mitigation | Tag |
|---|---|---|---|
| Missing `DATABASE_URL` | Boot fails (Drizzle throws) | set env | [VS] |
| Missing integration key | Feature degrades (`is*Configured`) | set key or accept degraded | [VS] |
| Webhook processing error | Event marked failed; possible dead-letter | reprocess (idempotent) | [VS] |
| Multi-instance crons | Duplicate job fire if unguarded | DB lock / single leader | [RPV] |
| DB outage | App + sessions impaired | host failover/restore | [RPV] |

---

## Performance Considerations

- esbuild bundling with a dependency allowlist targets **cold-start** reduction.
- Crons stagger first runs (`+60s`, `+5m`, `+8m`) to avoid a boot-time thundering herd.
- Pagination caps and `publicRateLimiter` bound request cost (see
  `docs/api-conventions.md`).

> **[RPV]** Real cold-start times, autoscale behavior under load, and DB connection
> pool sizing require production measurement.

---

## Future Improvements

- **Adopt committed migrations** (or a reviewed `db:push` gate) to replace push-only
  schema changes — reduces destructive-change risk.
- **Make cron execution multi-instance safe** (leader election / universal DB locks)
  before horizontal scaling.
- **Document the live deploy/rollback and backup/restore procedures** ([RPV] items)
  and promote this document to `Verified Against Production`.
- **Centralize a single health endpoint** that aggregates subsystem health for one
  monitor target.

---

## Related Documentation

- `CLAUDE.md` — Deployment Philosophy, Production Readiness Checklist, Critical Systems
- `docs/integrations.md` — provider credentials, webhooks, degradation
- `docs/core-services.md` — cron startup wiring, guard chain, dead-letter, heartbeat
- `docs/agent-catalog.md` — agent startup order, raw-SQL agent tables
- `docs/api-conventions.md` — health/webhook/SSE conventions
- `docs/schema.md` — tables referenced here (`sessions`, `stripe_webhook_events`,
  `financial_event_failures`, `job_execution_locks`, `ceo_heartbeat_runs`)

---

## Architecture Discrepancies

1. **Push-based schema vs. "non-destructive migrations" intent.** `CLAUDE.md`
   (Database Architecture, ADR-005) emphasizes "non-destructive migrations,"
   "reversible whenever practical," and a reviewed migration history. In source the
   only mechanism is `drizzle-kit push` with an empty `migrations/` directory — there
   is no committed migration history and `push` can be destructive. **Confirms** a real
   gap between intent and tooling.

2. **In-process cron scheduler vs. "background processes should be retry-safe /
   organization-aware."** `CLAUDE.md` (Background Jobs) calls for observable,
   retry-safe, idempotent jobs. The implementation is sound *per job* (locks, guards),
   but **all crons run in every web process via `setInterval`**, so the deployment
   model (single vs. multi-instance) is itself a correctness factor not addressed in
   `CLAUDE.md`.

3. **No documented backup/recovery or incident-response process.** `CLAUDE.md`
   references rollback planning and production safety, but neither the repo nor
   `CLAUDE.md` defines backup cadence, restore drills, or an incident runbook. This
   document supplies recommendations and marks them **[RPV]**.

4. **Operations docs cannot reach `Verified Against Production` from source alone.**
   This is expected per `documentation-status-legend.md` and is not a defect — it is
   the reason this document is `Partially Verified`.

No discrepancy contradicts a core security principle (secrets handling, tenant
isolation, emergency-pause control all hold).

---

## Recommended CLAUDE.md Updates

Concrete edits for a later reconciliation pass (with approval — none applied here):

1. **State the schema-change mechanism.** In Database Architecture, note that schema
   changes are applied via `drizzle-kit push` (`npm run db:push`) against
   `shared/schema.ts`, that there is currently no committed migration history, and that
   `push` requires diff review + backup because it can be destructive.

2. **Document the in-process scheduler and its scaling caveat.** In Background Jobs,
   note that crons start in-process at boot and that multi-instance deployment requires
   DB-lock-guarded jobs to avoid duplicate execution.

3. **Add an operational pointer** from Deployment Philosophy / Critical Systems to
   `docs/runbooks.md` for startup order, health checks, dead-letter recovery, and the
   emergency-pause kill-switch.

4. **Record the env-var contract** (the Production Readiness Checklist here) as the
   canonical required/optional secret list.

---

## Files Reviewed

| File | Notes |
|---|---|
| `.replit` | Deployment target, build/run, ports, shared/prod env, integrations |
| `package.json` | Scripts (dev/build/start/check/db:push) |
| `script/build.ts` | Typecheck-gated build; vite + esbuild; allowlist bundling |
| `script/stripe-wallet-repair.ts` | Standalone wallet repair tool (existence) |
| `drizzle.config.ts` | Push-based schema config, `out: ./migrations`, `DATABASE_URL` |
| `server/index.ts` | Full startup sequence, middleware order, cron wiring, listen, env check |
| `server/reliability-routes.ts` | `/healthz`, `/api/reliability/dashboard`, `logSystemEvent`, error capture |
| `server/services/ceo-heartbeat-service.ts` | Heartbeat interval, job locks (cross-ref) |
| `server/webhookHandlers.ts` | Stripe webhook idempotency, wallet sync/repair (cross-ref) |
| `server/services/agent-dead-letter-service.ts` | Dead-letter queue (cross-ref) |
| `docs/schema.md`, `docs/core-services.md`, `docs/agent-catalog.md`, `docs/integrations.md`, `docs/api-conventions.md` | Cross-reference for cited behavior |
| `docs/_template.md`, `docs/documentation-status-legend.md`, `docs/version-2-roadmap.md` | Structure/compliance |

**Verification methods:** direct reads of `.replit`, `package.json`, `drizzle.config.ts`,
`script/build.ts`, and the full `server/index.ts` startup region; grep for `/healthz`,
cron starters, and repair tooling; cross-reference to prior Verified-Against-Source
docs for subsystem internals. No production system was accessed.

---

## Confidence Assessment

**Overall: Partially Verified.**

- **High confidence [VS]:** build/run commands, startup sequence and ordering, the cron
  inventory and intervals, push-based schema model, health/logging surfaces, and the
  recovery *tooling* that exists in code.
- **Not verified [RPV]:** live deploy/rollback pipeline, backup/restore cadence,
  monitoring/alerting wiring, production instance count and autoscale behavior, and any
  real-traffic guarantee (deliverability, pixel match quality, OAuth app status).

**Limits:** No production access at authoring time, so no section is **[VP]**. Some
cited line numbers came from assisted reads; file paths, command strings, env-var
names, and function names are the stable citation basis. `server/index.ts` was read in
full for the startup section; subsystem internals were cross-referenced to existing
Verified-Against-Source documents rather than re-derived.

---

## Last Updated

Date: 2026-06-28

Author: Engineering (Operations — Partially Verified; production items flagged
Requires Production Validation)

Version: 1.0
