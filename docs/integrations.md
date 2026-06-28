---
Document Type: Implementation
Verification Status: Verified Against Source
Last Reviewed: 2026-06-28
Owner: Engineering
---

# External Integrations Reference

Comprehensive catalog of every external service integration in the TrainEfficiency
platform. All entries are derived directly from repository source files — package
names, environment variables, function names, endpoint URLs, and table names are
copied exactly as they appear in code. No summaries or inferences. Where an
integration is *referenced* (in a type union, env-detection table, or `CLAUDE.md`)
but has **no executing client code**, it is listed explicitly under
[Unverified / Declared-Not-Implemented](#unverified--declared-not-implemented-integrations).

---

## Document Status

This document covers the full external-integration layer as of 2026-06-28. It is the
fourth Version 2 implementation document, following `docs/schema.md`,
`docs/core-services.md`, and `docs/agent-catalog.md`. Every integration entry
includes its source file(s), npm dependency, environment variables, credential
mechanism, transport, webhook/inbound path (if any), and failure handling.

---

## Purpose

Document how TrainEfficiency connects to third-party services, how credentials are
stored and resolved, how outbound calls are governed and audited, and how each
integration degrades when unconfigured or unavailable.

Per `CLAUDE.md` (ADR-008 — *External Services Are Replaceable* and the *Integration
Philosophy* section), external services are treated as **dependencies, not sources of
truth**. This document records how that principle is actually implemented.

---

## Responsibilities

- Document every external service with executing client code in the repository
- Record the credential-resolution strategy for each (env var vs. Replit Connectors
  vs. per-org encrypted DB credentials)
- Document the shared integration framework: `credentials-vault.ts`,
  `integration-runtime.ts`, and `integration-status-service.ts`
- Document every webhook/inbound entry point and its authentication
- Identify integrations that are declared (type unions, env stubs, architecture docs)
  but **not** implemented
- Cross-reference DB tables that back integration state (defined in `docs/schema.md`)

---

## Does NOT Own

- Email *business logic* and the outbound guard chain — covered in
  `docs/core-services.md` (Communication Safety Stack, Email Delivery Layer)
- Agent send-path orchestration — covered in `docs/agent-catalog.md`
- Database table column definitions — covered in `docs/schema.md`
- Stripe *financial reconciliation* logic (ledger drift, wallet sync) beyond the
  webhook transport — covered in `docs/core-services.md`

---

## Architecture

### Integration Tiers

TrainEfficiency uses **three credential-resolution strategies**, often layered as
fallbacks within a single integration:

1. **Replit Connectors** — managed connected-account tokens fetched at runtime from
   the Replit sidecar (`REPLIT_CONNECTORS_HOSTNAME`). Used by SendGrid and Stripe.
2. **Per-org encrypted credentials** — stored in the `external_integrations` table
   (or `orgAiIntegrations` / `connector_tokens`), encrypted at rest via
   `credentials-vault.ts`. Used by Gmail, Google Calendar, Slack, OpenRouter,
   TrainChat.
3. **Process environment variables** — direct platform-level secrets. Used by
   OpenAI, Meta CAPI, Twilio, Obsidian, AgentMail, Composio, and as the fallback
   layer for most of the above.

### Shared Integration Framework

Three modules form the backbone that most governed integrations route through:

| Module | Role |
|---|---|
| `server/credentials-vault.ts` | AES-256-GCM encrypt/decrypt of per-org credentials stored in JSONB columns |
| `server/integration-runtime.ts` | Central execution wrapper: governance checks, idempotency, error classification, health tracking, immutable audit log |
| `server/services/integration-status-service.ts` | Resolves effective connection status (DB-first, env-var fallback); excludes infrastructure services |

**`server/integration-runtime.ts`** defines the canonical `IntegrationType` union
(verified in source):

```
"gmail" | "google_calendar" | "slack" | "openrouter" | "claude" |
"meta_ads" | "hubspot" | "twilio" | "stripe" | "discord" | "custom_webhook"
```

> **Important:** Membership in this union is **not** proof of implementation. Several
> members (`claude`, `meta_ads`, `hubspot`, `discord`, `custom_webhook`) have no
> executor and are documented as unverified below.

Its core function `executeIntegrationAction()` runs, in order: idempotency check →
governance check (`checkIntegrationGovernance`) → health pre-check → dry-run
short-circuit → executor invocation → error classification → audit write to
`integration_execution_log`. Error classes: `transient | permanent | rate_limited |
auth | governance | timeout`.

**`server/credentials-vault.ts`** uses `aes-256-gcm` with a key derived (SHA-256)
from `CREDENTIAL_ENCRYPTION_KEY`, falling back to `SESSION_SECRET`, then a hardcoded
dev fallback. It emits a versioned envelope `{ _v: 1, _enc, _iv, _tag }` safe for
JSONB storage, and `decryptCredentials()` returns `null` on failure (graceful).

**`server/services/integration-status-service.ts`** defines
`INFRASTRUCTURE_SERVICES = { hermes, agentmail, obsidian }` — internal services that
never display as "disconnected" external integrations. `getEffectiveConnectedIntegrations(orgId)`
returns the connected set, DB status winning over env-var detection.

### Status Summary

| Integration | npm package | Credential source | Transport | Status |
|---|---|---|---|---|
| Replit Auth (OIDC) | `openid-client`, `passport` | `REPL_ID` / `ISSUER_URL` | OIDC | ✅ Verified |
| Replit Connectors | (native fetch) | `REPLIT_CONNECTORS_HOSTNAME` | HTTP sidecar | ✅ Verified |
| Replit Object Storage / GCS | `@google-cloud/storage` | Replit sidecar (`127.0.0.1:1106`) | GCS external account | ✅ Verified |
| OpenAI | `openai` | env (`OPENAI_API_KEY`, `AI_INTEGRATIONS_OPENAI_*`) | SDK | ✅ Verified |
| OpenRouter | `openai` (compatible) | per-org DB + `OPENROUTER_API_KEY` | SDK (custom baseURL) | ✅ Verified |
| Stripe | `stripe`, `stripe-replit-sync` | Connectors + env + per-org | SDK + webhooks | ✅ Verified |
| SendGrid | `@sendgrid/mail` | Connectors + env | SDK | ✅ Verified |
| AgentMail | (native fetch) | env (`AGENTMAIL_*`) | REST (inbound-only v0) | ✅ Verified |
| Gmail | `googleapis`, `google-auth-library` | per-org DB (`external_integrations`) | SDK + OAuth | ✅ Verified |
| Google Calendar | `googleapis` / native fetch | per-org DB (two stores) | SDK + REST | ✅ Verified |
| Composio | (native fetch; SDK unused) | env (`COMPOSIO_API_KEY`) | REST v3 | ✅ Verified |
| Slack | (native fetch + Composio) | per-org DB + Composio | REST | ✅ Verified |
| Meta Pixel / CAPI | (native fetch) | env (`META_*`) | Graph API | ✅ Verified |
| Twilio (SMS) | `twilio` | env (`TWILIO_*`) | SDK | ✅ Verified |
| Obsidian | (native fetch) | env (`OBSIDIAN_*`) | REST | ✅ Verified |
| TrainChat | (native fetch) | per-org DB + env (`TRAINCHAT_*`) | REST | ✅ Verified |
| GitHub | (via Composio only) | Composio connected account | REST (Composio) | 🟡 Partial (Composio tool) |
| Anthropic / Claude (direct) | — | — | — | ⚪ Unverified (via OpenRouter only) |
| HubSpot | — | env stub only | — | ⚪ Unverified |
| Discord | — | type union only | — | ⚪ Unverified |
| Meta Ads (`meta_ads`) | — | env stub only | — | ⚪ Unverified |

---

## Components

### 1. Replit Platform

**Source:** `server/replit_integrations/` (auth, object_storage, audio, image, chat,
batch), plus connector helpers inline in `server/email.ts` and `server/stripeClient.ts`.

#### 1a. Replit Auth (OIDC)

**Source:** `server/replit_integrations/auth/replitAuth.ts`, `storage.ts`

- OIDC discovery via `openid-client`, issuer `process.env.ISSUER_URL` (default
  `https://replit.com/oidc`), client `process.env.REPL_ID`. Discovery memoized 1h.
- Passport strategy `replitauth:{domain}`, scope `openid email profile offline_access`,
  callback `https://{domain}/api/callback`. Strategies registered per host in
  `REPLIT_DOMAINS` (multi-domain support).
- Sessions persisted in the `sessions` table via `connect-pg-simple`
  (`DATABASE_URL`), 7-day TTL, secret `SESSION_SECRET`. Cookie: httpOnly, secure,
  `sameSite="none"`.
- `isAuthenticated` middleware supports `Authorization: Bearer <token>` (backed by an
  `auth_tokens` table) and falls back to session; expired sessions auto-refresh via
  `client.refreshTokenGrant()`.
- Claims upserted into `users`: `sub`, `email`, `first_name`, `last_name`,
  `profile_image_url`.

> Confirms `docs/schema.md` §1: the `sessions` and `users` tables are
> Replit-Auth-mandatory.

#### 1b. Replit Connectors

**Source:** inline in `server/email.ts` (lines ~239–298) and `server/stripeClient.ts`
(lines ~5–53).

- Fetches managed connected-account secrets from
  `GET https://{REPLIT_CONNECTORS_HOSTNAME}/api/v2/connection?include_secrets=true&connector_names={name}&environment={development|production}`.
- Auth header `X_REPLIT_TOKEN`: `'repl ' + REPL_IDENTITY` or
  `'depl ' + WEB_REPL_RENEWAL`. Environment chosen by `REPLIT_DEPLOYMENT === '1'`.
- 5-minute in-memory credential cache. Used for **SendGrid** (`sendgrid` connector →
  `api_key`, `from_email`) and **Stripe** (`stripe` connector → `publishableKey`,
  `secretKey`). Both fall back to direct env vars if the connector is unavailable.

#### 1c. Object Storage (Google Cloud Storage via Replit sidecar)

**Source:** `server/replit_integrations/object_storage/objectStorage.ts`,
`objectAcl.ts`, `routes.ts`. npm: `@google-cloud/storage`.

- GCS client uses a Replit **external-account** credential, not a service account:
  audience `"replit"`, token URL `http://127.0.0.1:1106/token`, credential source
  `http://127.0.0.1:1106/credential`.
- `PUBLIC_OBJECT_SEARCH_PATHS` (comma-separated public buckets) and
  `PRIVATE_OBJECT_DIR` (private upload dir) are required; both throw if unset.
- Signed upload URLs minted via the sidecar
  `POST http://127.0.0.1:1106/object-storage/signed-object-url` (PUT, 900s TTL).
- **ACL model** (`objectAcl.ts`): policy `{ owner, visibility: "public"|"private",
  aclRules[] }` stored in GCS object metadata key `custom:aclPolicy`; permissions
  `READ | WRITE`; access groups are an extensible abstract `BaseObjectAccessGroup`.
- Client upload uses Uppy (`@uppy/aws-s3`, `@uppy/dashboard`) against the signed URL.

#### 1d. Replit AI Integrations (audio / image / chat)

**Source:** `server/replit_integrations/audio/`, `image/`, `chat/`. These call
OpenAI through `AI_INTEGRATIONS_OPENAI_API_KEY` + `AI_INTEGRATIONS_OPENAI_BASE_URL`
(see OpenAI, §2).

- **audio/client.ts** — `voiceChat`, `voiceChatStream`, `textToSpeech`,
  `textToSpeechStream`, `speechToText`, `speechToTextStream`. Models `gpt-audio`,
  `gpt-4o-mini-transcribe`. Auto-converts incompatible formats to WAV via ffmpeg.
- **image/client.ts** — `generateImageBuffer`, `editImages`. Model `gpt-image-1`.
- **chat/routes.ts** — SSE streaming chat completions, model `gpt-5.1`, conversation
  state persisted via `chatStorage`.

#### 1e. Batch utilities

**Source:** `server/replit_integrations/batch/utils.ts`. `batchProcess` (concurrency
via `p-limit`, default 2; retries via `p-retry`, default 7, only on rate-limit
errors detected by `429|RATELIMIT_EXCEEDED|quota|rate limit`) and
`batchProcessWithSSE` (sequential, SSE progress events).

---

### 2. OpenAI

**Source:** ~40+ server files. npm: `openai` (v6). Primary LLM provider.

- **Two construction patterns coexist:**
  1. *Replit-integration pattern* (preferred): `AI_INTEGRATIONS_OPENAI_API_KEY` +
     `AI_INTEGRATIONS_OPENAI_BASE_URL` — used by `replit_integrations/{audio,image,chat}`,
     `scheduling-assistant.ts`, `ceo-agent-orchestrator.ts`, `pr-intelligence-routes.ts`.
  2. *Direct pattern* (legacy, widespread): `new OpenAI({ apiKey: process.env.OPENAI_API_KEY })`
     repeated across 40+ files (e.g. `email-agent/reply-classifier.ts`,
     `services/intelligent-lead-intake-service.ts`, `routes.ts`). There is **no single
     shared OpenAI client helper**; instantiation is decentralized.
- Default base URL is OpenAI's own unless `AI_INTEGRATIONS_OPENAI_BASE_URL` overrides.
- Models referenced in source: `gpt-4o` (dominant), `gpt-4o-mini`, `gpt-5.1` (chat
  synthesis), `gpt-audio`, `gpt-4o-mini-transcribe`, `gpt-image-1`.
- **Research agent** (`server/integrations/research-agent.ts`) uses the OpenAI
  Responses API with the `web_search_preview` tool (model `gpt-4o`), falling back to
  `chat.completions` with `gpt-4o-mini` (inference-only). Governed by a
  `research_agent` integration status, `webAccessEnabled` flag, a `blockedDomains`
  list, and a daily quota (default 50/day).
- **Degradation:** mixed — some callers hard-throw on missing key
  (`team-training-prospecting.ts`, `pr-intelligence-routes.ts`), some soft-skip
  (`financial-brain.ts`, `workflow-orchestrator.ts`), and `reliability-routes.ts`
  surfaces `MISSING OPENAI_API_KEY` in its health check.

> **Decentralized-client note:** the repeated `new OpenAI()` pattern is a
> maintainability concern flagged under [Future Improvements](#future-improvements);
> it is *not* a defect.

---

### 3. OpenRouter

**Source:** `server/integrations/openrouter.ts`, `server/ai-model-runtime.ts`. Uses
the `openai` SDK pointed at `https://openrouter.ai/api/v1`.

- **Purpose:** multi-model routing with cost tiers and cross-provider fallback.
- **Routing tiers** (`openrouter.ts`):
  - economy → `openai/gpt-4o-mini` (fallback `anthropic/claude-3-haiku`)
  - balanced → `openai/gpt-4o` (fallback `anthropic/claude-3-5-sonnet`)
  - premium → `anthropic/claude-opus-4` (fallback `openai/o1-mini`)
  - multimodal → `google/gemini-2.0-flash-001` (fallback `openai/gpt-4o`)
- **Credential resolution:** per-org OpenRouter integration first
  (`getIntegration(orgId, "openrouter")`), then `OPENROUTER_API_KEY`, then OpenAI as
  final fallback. `mapToOpenAIModel()` maps Anthropic model names back to OpenAI
  equivalents when OpenRouter is unavailable.
- **`ai-model-runtime.ts`** abstracts `provider: "openrouter" | "openai"`, logs every
  call to `integration_execution_log` via `writeAILog()` (latency, `tokensUsed`,
  `costCents`, model, governance decision) and `logUnifiedAction()`. Honors the
  org-level emergency-pause governance flag (`orgAiGovernanceSettings.emergencyPauseEnabled`).

> **Anthropic/Claude access is exclusively through OpenRouter's OpenAI-compatible
> API.** There is no direct `@anthropic-ai/sdk` usage anywhere in the repository
> (verified by grep). See [Unverified](#unverified--declared-not-implemented-integrations).

---

### 4. Stripe

**Source:** `server/stripeClient.ts`, `server/webhookHandlers.ts`,
`server/connectors/stripe-invoicing.ts`, `server/index.ts` (webhook route),
`server/phase10-routes.ts` (marketplace webhook). npm: `stripe` (v20),
`stripe-replit-sync` (v1).

- **Client:** `getUncachableStripeClient()` → `new Stripe(secretKey)` (no pinned API
  version). Credential priority: Replit Connectors → `STRIPE_SECRET_KEY` /
  `STRIPE_PUBLISHABLE_KEY` → throw.
- **Per-org Stripe Connect:** the `organizations` table carries `stripe_secret_key` /
  `stripe_publishable_key`; `getOrgStripeForQuote()` (`webhookHandlers.ts`)
  instantiates a per-org client when present, else the platform client.
- **`stripe-replit-sync`:** `runMigrations()` at boot; a `StripeSync` instance
  (`DATABASE_URL`, max 2 conns) handles `processWebhook()`,
  `findOrCreateManagedWebhook()`, and `syncBackfill()`. When `STRIPE_WEBHOOK_SECRET`
  is absent it warns and falls back to the managed-webhook secret in the DB.
- **Webhook:** `POST /api/stripe/webhook` (registered with `express.raw()` before
  `express.json()`). Signature via `stripe-signature` header →
  `stripe.webhooks.constructEvent()`. Handled events: `invoice.paid`,
  `invoice.payment_succeeded`, `customer.subscription.{created,updated,deleted}`,
  `checkout.session.completed`, `payment_intent.succeeded`, `charge.succeeded`.
- **Idempotency:** the `stripe_webhook_events` table (UNIQUE `stripe_event_id`);
  `checkAndInsertWebhookEvent()` inserts status `processing`, handles concurrent-insert
  races, and returns `alreadyProcessed` on duplicates. Failed wallet credits are
  written to `financial_event_failures` (dead-letter, `maxAttempts: 3`).
- **Marketplace webhook:** `POST /api/stripe/marketplace-webhook` with
  `STRIPE_MARKETPLACE_WEBHOOK_SECRET` (royalty distribution on
  `checkout.session.completed`).
- **Agent invoicing** (`connectors/stripe-invoicing.ts`): `getOrCreateStripeCustomer`,
  `createAgentInvoice`, `recordManualPayment`, `markAgentInvoicePaid` (returns
  `workflowRunId` for resumption), `linkInvoiceToWorkflow`, `listAgentInvoices`,
  `listUnpaidAgentInvoices`. Backed by the `agent_invoices` table.

> Stripe financial-correctness rules and ledger reconciliation are documented in
> `docs/core-services.md` (`financial-metrics.ts`) — not repeated here.

---

### 5. SendGrid (transactional email)

**Source:** `server/email.ts`; inbound route in `server/routes.ts`. npm:
`@sendgrid/mail`.

- **Client:** `getUncachableSendGridClient()` → `getCredentials()` resolves
  `SENDGRID_API_KEY` + `SENDGRID_FROM_EMAIL`, falling back to the Replit `sendgrid`
  connector. `setApiKey()` then returns `{ client, fromEmail }`.
- **Config checks:** `isEmailProviderConfigured()` (fast: env or connector present),
  `validateEmailProvider()` (async, called at startup in `index.ts`; warns and
  continues if unconfigured).
- **Inbound Parse webhook:** `POST /api/webhooks/sendgrid-inbound`. Optional
  URL-token guard `?token=<SENDGRID_INBOUND_SECRET>` (only enforced if the secret is
  set). Always responds 200 immediately, then processes asynchronously (matches
  prospect by sender email, marks replied, AI-classifies intent).

> The transactional send functions (`sendWelcomeEmail`, `sendBookingConfirmationToClient`,
> etc.) and the outbound guard chain are documented in `docs/core-services.md`.

---

### 6. AgentMail (AI agent inboxes)

**Source:** `server/services/agentmail-service.ts`, `agentmail-send-guard.ts`,
`agentmail-inbound-router.ts`, `server/agentmail-routes.ts`. **No SDK — raw `fetch`.**

- **Config** (`getConfig()`): `AGENTMAIL_API_KEY`, `AGENTMAIL_BASE_URL` (default
  `https://api.agentmail.to/v0`), `AGENTMAIL_DEFAULT_FROM`, `AGENTMAIL_WEBHOOK_SECRET`,
  `AGENTMAIL_ORG_DOMAIN` (default `agentmail.to`). Transport `agentMailRequest()`
  sends `Authorization: Bearer ${apiKey}`, 15s timeout. `isAgentMailConfigured()`
  requires apiKey + baseUrl.
- **Inboxes:** per-agent addresses (revenue, hiring, scheduling, support, operations,
  ceo). `listInboxes()` (`GET /inboxes`), `createOrVerifyInbox()`,
  `getInboxMessages()` (`GET /inboxes/{email}/threads`).
- **Outbound is currently inbound-only (v0):** `sendAgentEmail()` and
  `replyFromAgentInbox()` run the send guard, then POST to `/inboxes/{email}/emails` —
  but the AgentMail v0 API returns 404 for outbound; source comments direct outbound
  through the Gmail agent instead. Sends are logged to `agent_mail_messages` and
  `outbound_email_audit_log`.
- **Webhook:** `POST /api/agentmail/webhook`, HMAC-SHA256 signature in
  `x-agentmail-signature` validated against `AGENTMAIL_WEBHOOK_SECRET` (supports
  `whsec_`-prefixed and legacy raw secrets). Events `email.received` / `inbound` /
  `event.email` → `processInboundAgentMail()` (idempotent on `provider_message_id`,
  classifies, persists to `agent_mail_inbound_messages`, fans out to
  `team_training_prospects` / `employmentApplicants` / `software_improvement_tasks` /
  `attention_items`).
- **Separation:** AgentMail is **completely independent of SendGrid** — different
  vendor, credentials, and protocol; zero cross-references. It is an
  `INFRASTRUCTURE_SERVICES` member (not shown as a user-facing external integration).
- **Degradation:** routes return 503 when unconfigured; the send guard defaults to
  BLOCK on any policy error.

---

### 7. Gmail (Google)

**Source:** `server/services/gmail-agent-service.ts`, `server/integrations/gmail.ts`,
`server/services/gmail-sync-state.ts`, OAuth flow in `server/routes.ts`. npm:
`googleapis`, `google-auth-library`.

- **Credentials are per-org, NOT via Replit Connectors.** Admin saves Client ID/Secret
  via `POST /api/integrations/:type/credentials`; encrypted (AES-256-GCM) into
  `external_integrations.encrypted_credentials`. OAuth callback
  `GET /api/integrations/gmail/callback` exchanges the code
  (`oauth2Client.getToken`) and merges access/refresh tokens into the encrypted blob.
- **Scopes:** `gmail.send`, `gmail.readonly`, `gmail.modify`.
- **`gmail-agent-service.ts` exports:** `getGmailClient`, `gmailSendEmail`,
  `gmailCreateDraft`, `gmailSearchInbox`, `gmailReadThread`, `gmailListRecentReplies`,
  `gmailClassifyReply` (OpenAI), `gmailTrackConversation` (→ `gmail_conversations`),
  `gmailGetThreadByEmail`, `gmailMarkThreadProcessed`, `runLeadReplyRecovery`. MIME is
  hand-built (RFC 2822, base64url).
- **Token refresh:** the `oauth2Client.on("tokens")` callback re-encrypts and persists
  refreshed tokens back to `external_integrations`; errors are logged, not thrown.
- **`integrations/gmail.ts`** is the higher-level wrapper routed through
  `integration-runtime.ts` (`gmailSendEmail`, `gmailCreateDraft`, `gmailClassifyReply`,
  `gmailSummarizeConversation`, `testGmailConnection`).
- **`gmail-sync-state.ts`:** per-org sync state (`lastSyncAt`, `nextSyncAt`, `status`,
  `errorMessage`), 60-minute interval/stale threshold, 55s job lock; `runGmailSyncForOrg`
  calls `runLeadReplyRecovery`. Cron via `startGmailSyncCron()`.
- **Degradation:** Gmail operations throw `Gmail not connected for org {orgId}` when
  the integration is absent or status ≠ `connected`.

---

### 8. Google Calendar

**Source:** **two** implementations with distinct credential stores. npm: `googleapis`,
`google-auth-library`.

| | `server/connectors/google-calendar.ts` | `server/integrations/google-calendar.ts` |
|---|---|---|
| Transport | Direct REST via `fetch()` | `googleapis` (`google.calendar` v3) |
| Token store | `connector_tokens` table | `external_integrations` (encrypted) |
| Credential source | per-org stored **or** `GOOGLE_CLIENT_ID`/`SECRET` env | per-org stored client ID/secret |
| Governance | Direct API (no runtime wrapper) | Wrapped in `executeIntegrationAction` |
| Scope | `calendar.events` | `calendar.events` |

- **`connectors/` exports:** `isGoogleCalendarConfigured`, `getGoogleAuthUrl(...)`,
  `exchangeCodeAndStoreTokens(...)`, `getFreshAccessToken` (auto-refresh + persist via
  SQL UPDATE), `createCalendarEvent`, `updateCalendarEvent`, `deleteCalendarEvent`,
  `checkConflicts`, `getGoogleCalendarStatus`.
- **`integrations/` exports:** `calendarGetAvailability`, `calendarCreateBooking`
  (acquires an execution lock to prevent double-booking), `calendarReschedule`,
  `calendarCancelEvent`.
- A **third** path exists via Composio (`GOOGLECALENDAR_*` tools — see §10).

> The coexistence of three calendar paths is flagged under
> [Architecture Discrepancies](#architecture-discrepancies).

---

### 9. Composio (tool orchestration)

**Source:** `server/services/composio-service.ts`, `composio-action-adapter.ts`,
`composio-tool-registry.ts`, `composio-routes.ts`, `composio-slack-alert-routes.ts`,
`composio-calendar-routes.ts`, `composio-gmail-draft-routes.ts`,
`composio-hermes-emitter.ts`.

- **Client:** native `fetch` against the **Composio v3 REST API** at
  `https://backend.composio.dev` with header `x-api-key: ${COMPOSIO_API_KEY}`, 20s
  timeout. The `composio-core` npm package (v0.5.39) is present in `package.json` but
  **is not imported** — source comments mark it deprecated. `COMPOSIO_API_KEY` is
  required or the call throws; `checkComposioHealth()` reports `apiKeyPresent: false`
  gracefully.
- **Purpose:** governed tool-calling over connected accounts. The tool registry
  (`composio-tool-registry.ts`) whitelists per-tool actions and per-agent grants:
  - **GMAIL** — drafts/read only; `GMAIL_SEND_EMAIL` blocked; approval required.
  - **GOOGLECALENDAR** — read + approval-gated write; destructive ops blocked.
  - **SLACK** — channel messaging only (no DMs, no autonomous posting); approval required.
  - **GOOGLESHEETS** — read/write, no approval.
  - **GITHUB** — read + approval-gated `GITHUB_CREATE_AN_ISSUE` only; PR/merge blocked.
  - **STRIPE** — read-only.
- **Audit/queue tables:** `composio_action_log`, `autonomous_action_queue`,
  `composio_slack_alert_requests`, `composio_gmail_draft_requests`,
  `composio_calendar_requests`, `composio_hermes_events`.
- **`composio-hermes-emitter.ts`:** writes structured `composio_hermes_events` (Phase 1
  — store only, no trust/autonomy mutation; Hermes write failures are silent).

---

### 10. Slack

**Source:** `server/integrations/slack.ts`, `server/composio-slack-alert-routes.ts`
(approval flow). Accessed **two ways**:

1. **Direct** via `integration-runtime.ts` (`getIntegration(orgId, "slack")`): posts
   using a stored `botToken` (`POST https://slack.com/api/chat.postMessage`) or a
   stored `webhookUrl` (incoming webhook). Credentials live in `external_integrations`.
2. **Via Composio** for agent-initiated alerts, which are **always approval-gated**.

- **Approval workflow** (`composio-slack-alert-routes.ts`): permitted agents are
  `ceo_heartbeat`, `executive_agent`, `software_improvement_agent`, `revenue_agent`.
  Routes: `POST /api/composio/slack-alert/request` (validates agent + alert type,
  persists only when `queued_for_approval`, returns 202),
  `GET .../pending`, `GET .../all` (ADMIN), `POST .../:id/approve` (executes via
  Composio; keeps `alert_queued` and returns 502 on Composio failure — no false
  success), `POST .../:id/cancel`.
- **Env-var detection returns `false` for Slack** (`integration-status-service.ts`) —
  Slack is intentionally **DB-only**; there is no `SLACK_*` env-var path.

---

### 11. Meta Pixel / Conversions API (CAPI)

**Source:** `server/meta-capi.ts`, `server/meta-book-capi.ts`,
`client/src/lib/meta-pixel.ts`, `client/src/hooks/use-meta-capi.ts`. (Note:
`server/meta.ts` is **unrelated** — it injects Open Graph tags, not pixel/CAPI.)

- **`meta-capi.ts`** — server CAPI. Endpoint
  `https://graph.facebook.com/v19.0/{PIXEL_ID}/events`, token `META_CAPI_TOKEN`.
  `sendCapiEvent()` hashes `em`/`ph` (SHA-256), forwards `fbp`/`fbc`/IP/UA.
  Idempotency key from `eventId > leadId > submissionId > 1-min bucket`, checked
  against `integration_execution_log`. Honors emergency-pause governance. Route
  `POST /api/meta/event` (`registerMetaCapiRoutes`). Error classes `auth |
  rate_limited | transient | permanent`.
- **`meta-book-capi.ts`** — book-funnel CAPI. `META_BOOK_PIXEL_ID`,
  `META_BOOK_ACCESS_TOKEN`. Allowed events whitelist `ViewContent | Lead |
  InitiateCheckout`. In-process 5-minute dedup Set. Returns
  `{ sent:false, reason:"secrets_missing" }` when unconfigured.
- **Client** — `meta-pixel.ts` initializes the browser `fbq` pixel and emits
  `PageView/ViewContent/Lead/InitiateCheckout`; `use-meta-capi.ts` posts to
  `/api/meta/event`. **Event dedup** between browser pixel and server CAPI uses a
  shared `event_id` (`crypto.randomUUID()`), satisfying `CLAUDE.md`'s "avoid duplicate
  event reporting" requirement.

---

### 12. Twilio (SMS)

**Source:** `server/sms.ts`; opt-out webhook in `server/routes.ts`. npm: `twilio`.

- **Client:** `getTwilioClient()` lazily `require('twilio')(sid, token)` from
  `TWILIO_ACCOUNT_SID` / `TWILIO_AUTH_TOKEN`; `TWILIO_PHONE_NUMBER` is the sender.
  `isTwilioConfigured()` requires all three.
- **Send:** `sendSms({ to, body, ctx })` normalizes the phone (`normalizePhone`),
  checks consent, then `client.messages.create(...)`. Returns
  `{ sent:false, skipped:'twilio_not_configured' | 'twilio_client_error' |
  'emergency_pause' }` for the graceful paths. Mirrors to `integration_execution_log`.
- **Consent:** user `sms_opt_in` + org-preference override + per-type
  `notification_preferences.sms[type]`. Operational coach→client messages bypass the
  opt-in gate; marketing/automated outreach require explicit opt-in.
- **Inbound STOP/START webhook:** `POST /api/twilio/sms/incoming` → `STOP`
  unsubscribes (`updateUserSmsOptIn(..., false, 'twilio_stop')`), `START` resubscribes.
- **Template builders:** `smsBookingConfirmation`, `smsCancellation`, `smsReschedule`,
  `smsReminder`, `smsOutreach`.

> Twilio/SMS is implemented but **absent from `CLAUDE.md`** — see
> [Architecture Discrepancies](#architecture-discrepancies).

---

### 13. Obsidian (organizational memory)

**Source:** `server/services/obsidian-service.ts` (+ `obsidian-sync-service.ts`,
documented in `docs/core-services.md`). **Raw REST.**

- **Config:** `OBSIDIAN_BASE_URL` (trailing slash stripped), `OBSIDIAN_API_KEY`.
  `isObsidianConfigured()` requires both.
- **Transport:** `obsidianRequest()` — GET/PUT/POST/DELETE to `/vault/{folder}/{title}.md`,
  `Authorization: Bearer ${apiKey}`, header `ngrok-skip-browser-warning: true`,
  content-type `text/markdown` (JSON for `/search/simple`).
- **Connection probing:** `checkConnection()`, `probeEndpoints()` test candidate paths
  to discover the working endpoint shape.
- `INFRASTRUCTURE_SERVICES` member (internal). Writer functions and queue semantics
  are documented in `docs/core-services.md` §10.

---

### 14. TrainChat (external program generation)

**Source:** `server/services/trainchat-client.ts`, `server/integrations-routes.ts`.
**Raw REST.**

- **External service** that generates strength & conditioning programs/sessions (JSON).
- **Credential resolution:** per-org row in `orgAiIntegrations` (`provider="trainchat"`,
  `apiKeyEncrypted` via **AES-256-CBC** keyed on `INTEGRATION_ENCRYPTION_SECRET`,
  `apiBaseUrl`) first, then env `TRAINCHAT_API_KEY` / `TRAINCHAT_EXTERNAL_API_KEY` +
  `TRAINCHAT_API_BASE_URL` / `TRAINCHAT_EXTERNAL_API_BASE_URL` / `TRAINCHAT_BASE_URL`.
- **API (`trainChatClient`):** `generateProgram` (`POST /api/external/programs/generate`),
  `generateSession`, `editProgram`, `swapExercise`, `explainProgram`, `getProgram`,
  `listExercises`. Bearer auth. Responses validated with Zod
  (`ProgramResponseSchema`, `SessionResponseSchema`).
- **Fallback:** if TrainChat is unreachable and `OPENAI_API_KEY` is set,
  `generateProgramViaOpenAI` / `generateSessionViaOpenAI` (gpt-4o-mini) produce a
  fallback marked `usedFallback: true`.
- **Management API** (`integrations-routes.ts`): `GET/POST/DELETE
  /api/org/integrations/trainchat` and `POST .../test` (ADMIN-gated).

> **Encryption inconsistency:** TrainChat uses AES-256-**CBC** keyed on
> `INTEGRATION_ENCRYPTION_SECRET`, whereas `credentials-vault.ts` uses AES-256-**GCM**
> keyed on `CREDENTIAL_ENCRYPTION_KEY`. Flagged under
> [Architecture Discrepancies](#architecture-discrepancies).

---

### 15. GitHub (via Composio only) — Partial

**Source:** `server/composio-tool-registry.ts` (GITHUB tool block). There is **no
standalone GitHub client, Octokit dependency, or `GITHUB_*` env path** in the
repository. GitHub is reachable only as a Composio tool: read actions plus
approval-gated `GITHUB_CREATE_AN_ISSUE`; PR/merge/update actions are blocked. Granted
to the `software_improvement_agent`.

> `CLAUDE.md` lists GitHub as a first-class external integration; in source it exists
> only inside the Composio tool registry. See
> [Architecture Discrepancies](#architecture-discrepancies).

---

## Unverified / Declared-Not-Implemented Integrations

The following are *referenced* in type unions, env-detection stubs, or `CLAUDE.md`
but have **no executing client code** (verified by grep over `server/integrations/`,
`server/connectors/`, and env usage):

| Name | Where referenced | Implementation status |
|---|---|---|
| **Anthropic / Claude (direct)** | `IntegrationType` member `"claude"`; `@anthropic-ai/claude-code` in `package.json`; OpenRouter fallback model names | ⚪ **Not implemented as a direct integration.** No `@anthropic-ai/sdk` import. Claude is reached **only** via OpenRouter (§3). `@anthropic-ai/claude-code` is a developer CLI dependency, not a runtime client. |
| **HubSpot** | `IntegrationType` member `"hubspot"`; `integration-status-service.ts` detects `HUBSPOT_ACCESS_TOKEN`/`HUBSPOT_API_KEY` | ⚪ **Not implemented.** No client code; env detection stub only. |
| **Discord** | `IntegrationType` member `"discord"` | ⚪ **Not implemented.** Type-union placeholder only. |
| **Meta Ads (`meta_ads`)** | `IntegrationType` member; `integration-status-service.ts` detects `META_ADS_ACCESS_TOKEN` | ⚪ **Not implemented.** Distinct from Meta Pixel/CAPI (§11), which *is* implemented. |
| **`custom_webhook`** | `IntegrationType` member | ⚪ **Not implemented.** Type-union placeholder for future generic webhooks. |

---

## Data Flow

### Governed outbound call (canonical)

```
Caller (agent / route / cron)
    │
    ▼
integration-runtime.executeIntegrationAction(input)
    ├── idempotency check (idempotencyKey → integration_execution_log)
    ├── checkIntegrationGovernance() → blocked / approval_required / allow
    ├── health pre-check (paused? degraded?)
    ├── dryRun? → short-circuit
    ▼
executor() → external API (Gmail / Calendar / Slack / OpenRouter / …)
    │
    ▼
classify result → update external_integrations health
    │
    ▼
write integration_execution_log (immutable audit)
```

### Credential resolution (canonical)

```
Need credentials for integration X
    │
    ├── Replit Connector available? (SendGrid, Stripe) ──► use sidecar secret
    │
    ├── Per-org external_integrations row, status=connected?
    │        └─► decryptCredentials() [AES-256-GCM, credentials-vault]
    │
    └── Fallback: process.env.<X>_API_KEY / <X>_* ──► or graceful "not configured"
```

### Inbound webhooks

| Source | Route | Auth |
|---|---|---|
| Stripe | `POST /api/stripe/webhook` | `stripe-signature` (constructEvent) |
| Stripe marketplace | `POST /api/stripe/marketplace-webhook` | `STRIPE_MARKETPLACE_WEBHOOK_SECRET` |
| SendGrid inbound | `POST /api/webhooks/sendgrid-inbound` | optional `?token=SENDGRID_INBOUND_SECRET` |
| AgentMail | `POST /api/agentmail/webhook` | HMAC `x-agentmail-signature` |
| Twilio SMS | `POST /api/twilio/sms/incoming` | (Twilio inbound) |
| Meta CAPI (outbound only) | — | — |

---

## Dependencies

### Internal

| Module | Used by |
|---|---|
| `server/credentials-vault.ts` | Gmail, Google Calendar (integrations), Slack, OpenRouter, integration-runtime |
| `server/integration-runtime.ts` | Gmail, Google Calendar (integrations), Slack, OpenRouter, Meta CAPI, Twilio logging |
| `server/services/integration-status-service.ts` | Admin integration dashboard, agent eligibility checks |
| Replit Connectors helpers (`email.ts`, `stripeClient.ts`) | SendGrid, Stripe |

### External (npm)

| Package | Integration |
|---|---|
| `stripe`, `stripe-replit-sync` | Stripe |
| `@sendgrid/mail` | SendGrid |
| `googleapis`, `google-auth-library` | Gmail, Google Calendar |
| `openai` | OpenAI, OpenRouter, Replit AI (audio/image/chat) |
| `twilio` | SMS |
| `@google-cloud/storage` | Object storage (GCS via Replit sidecar) |
| `openid-client`, `passport`, `passport-local`, `connect-pg-simple` | Replit Auth |
| `composio-core` | **Present but unused** — Composio uses raw REST |
| `@uppy/aws-s3`, `@uppy/core`, `@uppy/dashboard` | Client object-storage uploads |

---

## Security Considerations

**Authentication.** Replit OIDC establishes identity; per-org integration credentials
are never trusted from the client. Webhooks each verify a provider signature or shared
secret (Stripe signature, AgentMail HMAC, optional SendGrid URL token).

**Authorization.** Composio tool actions and `integration-runtime` actions are
governed by per-agent whitelists, approval gates, and an org-wide emergency-pause flag
(`orgAiGovernanceSettings.emergencyPauseEnabled`). Integration management routes
(TrainChat, Gmail/Calendar connect) require `ADMIN`.

**Data ownership.** All integration state is org-scoped: `external_integrations`,
`orgAiIntegrations`, `connector_tokens`, and `integration_execution_log` carry
`org_id`. The `connect/disconnect` surface is per-org.

**Credential storage.** At-rest encryption uses AES-256-GCM (`credentials-vault.ts`,
keyed on `CREDENTIAL_ENCRYPTION_KEY` → `SESSION_SECRET` fallback). TrainChat uses a
separate AES-256-CBC path keyed on `INTEGRATION_ENCRYPTION_SECRET`. Secrets are
masked (`••••••••{last4}`) before returning to the frontend. No secret is logged.

**Validation.** Every governed call is idempotency-checked and audited; Meta CAPI
hashes PII (email/phone) before transmission; AgentMail and Twilio default to
BLOCK/skip on policy error.

---

## Failure Modes

| Failure | Behavior |
|---|---|
| Missing credentials (most integrations) | `is*Configured()` returns false; caller soft-skips or returns `{ sent:false, reason/skipped }` |
| Missing OpenAI key | Mixed: some callers hard-throw, some soft-skip; surfaced in `reliability-routes.ts` health |
| Stripe webhook secret absent | Warns; falls back to managed-webhook secret in DB |
| Stripe wallet-credit failure | Dead-letter to `financial_event_failures` (`maxAttempts: 3`) |
| Gmail/Calendar not connected | Throws `… not connected for org {orgId}` |
| Composio key absent | `checkComposioHealth()` reports disconnected; execution throws |
| Composio action failure | Request kept in `*_queued` state (retryable); approve route returns 502, not false success |
| AgentMail outbound (v0) | Returns 404 — outbound delegated to Gmail agent |
| Integration repeated failures | `integration-runtime` auto-degrades `connected → degraded` after ~5 failures in last 10 logs; auto-recovers on clean run |
| Emergency pause enabled | All governed sends blocked (`emergency_pause` / `governance_blocked`) |

---

## Performance Considerations

**Caching.** Replit Connector secrets cached 5 min; OIDC discovery memoized 1h; signed
object URLs TTL 900s. No caching of LLM responses.

**Concurrency.** Object-storage batch utilities cap concurrency (default 2) and retry
only rate-limit errors (default 7, exponential backoff). Cron-backed syncs (Gmail) use
55s job locks per org.

**Indexes.** Integration audit/queue tables (`integration_execution_log`,
`composio_action_log`, `composio_*_requests`) are indexed on `org_id` (see
`docs/schema.md`).

**Rate limits.** `integration-runtime` classifies `rate_limited` (429/quota) distinctly
and records `rate_limit_state` on `external_integrations`. The research agent enforces a
daily web-search quota.

---

## Future Improvements

- **Centralize OpenAI client construction.** ~40+ files call `new OpenAI()`
  independently; a shared factory honoring `AI_INTEGRATIONS_OPENAI_*` would reduce
  drift and ease provider migration (supports `CLAUDE.md` ADR-008).
- **Unify credential encryption.** TrainChat (AES-256-CBC / `INTEGRATION_ENCRYPTION_SECRET`)
  diverges from the vault standard (AES-256-GCM / `CREDENTIAL_ENCRYPTION_KEY`).
- **Consolidate Google Calendar.** Three coexisting access paths (`connectors/`,
  `integrations/`, Composio) with two token stores increase maintenance surface.
- **Remove the unused `composio-core` dependency** or adopt it; the raw-REST client is
  the real implementation.
- **Prune or implement declared integrations.** `claude`, `hubspot`, `discord`,
  `meta_ads`, `custom_webhook` are type-union/env stubs without executors.

---

## Related Documentation

- `docs/schema.md` — `external_integrations`, `orgAiIntegrations`, `connector_tokens`,
  `stripe_webhook_events`, `integration_execution_log`, `agent_invoices`,
  `agent_mail_*`, `composio_*` table definitions
- `docs/core-services.md` — Email Delivery Layer (SendGrid), AgentMail services,
  Obsidian writers, financial metrics (Stripe reconciliation)
- `docs/agent-catalog.md` — agent send paths, Composio-mediated agent actions
- `CLAUDE.md` — Technology Stack & External Integrations; ADR-008 (External Services
  Are Replaceable); Integration Philosophy

---

## Architecture Discrepancies

Differences between repository source and `CLAUDE.md`:

1. **Integrations implemented but undocumented in `CLAUDE.md`.** The *Technology Stack
   & External Integrations* and *External Integrations* sections of `CLAUDE.md` list
   Stripe, OpenAI, Gmail, Slack, Google Calendar, GitHub, and Meta. Source adds at
   least **OpenRouter** (`server/integrations/openrouter.ts`), **Composio**
   (`server/services/composio-service.ts`), **Twilio/SMS** (`server/sms.ts`),
   **AgentMail** (`server/services/agentmail-service.ts`), **Obsidian**
   (`server/services/obsidian-service.ts`), **TrainChat**
   (`server/services/trainchat-client.ts`), and **Replit Object Storage / Google Cloud
   Storage** (`server/replit_integrations/object_storage/`). None are named in
   `CLAUDE.md`.

2. **Anthropic is named as a peer AI provider but only reachable via OpenRouter.**
   `CLAUDE.md` model guidance and the *Artificial Intelligence* section imply direct
   Claude/Anthropic usage, and `integration-runtime.ts` declares a `"claude"`
   `IntegrationType`. In source there is **no `@anthropic-ai/sdk`**; Claude models are
   invoked solely as OpenRouter fallbacks (`anthropic/claude-3-5-sonnet`,
   `anthropic/claude-opus-4`). `@anthropic-ai/claude-code` in `package.json` is a
   developer CLI, not a runtime integration.

3. **Slack is a first-class integration in `CLAUDE.md` but is mediated through
   Composio.** Source posts Slack messages via a stored bot token/webhook through
   `integration-runtime`, but all *agent-initiated* Slack messaging is approval-gated
   through Composio (`composio-slack-alert-routes.ts`), and Slack has **no env-var
   path** (`integration-status-service.ts` returns `false` for Slack env detection).

4. **GitHub is listed as an external integration but exists only inside Composio.**
   `CLAUDE.md` (*External Integrations* domain) names GitHub alongside Stripe/Gmail/etc.
   Source has no standalone GitHub client — only the `GITHUB` block in
   `composio-tool-registry.ts` (read + approval-gated issue creation).

5. **Twilio/SMS is entirely absent from `CLAUDE.md`'s Communications domain.** The
   *Communications* and *Communication* sections list Email, Slack, Notifications, and
   in-app messaging, but not SMS, despite a full implementation in `server/sms.ts`
   including consent management and a STOP/START webhook.

6. **The integration governance/credential framework is undocumented.**
   `CLAUDE.md` (ADR-008, Integration Philosophy) calls for abstraction behind platform
   services but does not document the concrete mechanism:
   `integration-runtime.executeIntegrationAction`, `credentials-vault`, and
   `integration-status-service`. Source **confirms** the ADR-008 intent — this is a
   documentation gap, not a conflict.

7. **Credential-encryption inconsistency.** Two encryption standards coexist: the vault
   (AES-256-GCM / `CREDENTIAL_ENCRYPTION_KEY`) and TrainChat (AES-256-CBC /
   `INTEGRATION_ENCRYPTION_SECRET`). `CLAUDE.md` does not state a canonical standard.

8. **Stripe Connect is per-org via DB columns**, not only via Replit Connectors.
   `CLAUDE.md` Billing implies a single Stripe surface; source supports per-org
   `organizations.stripe_secret_key` connected accounts.

No discrepancy was found that contradicts a **core security principle** (tenant
isolation, server-side authorization, encrypted credentials) — all integrations honor
org-scoping and server-side credential handling.

---

## Recommended CLAUDE.md Updates

Concrete, actionable edits:

1. **Expand the External Integrations lists** (in *Technology Stack & External
   Integrations* and the *External Integrations* domain) to add: **OpenRouter,
   Composio, Twilio (SMS), AgentMail, Obsidian, TrainChat, Replit Object Storage /
   Google Cloud Storage.** Group them as "Verified in source (see
   `docs/integrations.md`)."

2. **Clarify AI provider reality.** In the *Artificial Intelligence* / *AI Platform*
   sections, state: "Anthropic Claude models are accessed exclusively via OpenRouter;
   there is no direct Anthropic SDK. `@anthropic-ai/claude-code` is a development CLI,
   not a runtime integration." Add OpenRouter as the multi-model routing layer.

3. **Reclassify Slack and GitHub as Composio-mediated.** Note that Slack agent
   messaging and all GitHub access are routed through Composio's approval-gated tool
   registry, not standalone SDKs.

4. **Add SMS/Twilio to the Communications domain**, including consent (`sms_opt_in`,
   per-type preferences) and the STOP/START webhook, to keep the *provider-independent
   communications* claim accurate.

5. **Document the integration framework** as the realization of ADR-008: add a short
   subsection naming `integration-runtime.executeIntegrationAction` (governance +
   idempotency + audit), `credentials-vault` (AES-256-GCM at rest), and
   `integration-status-service` (DB-first, env fallback; `INFRASTRUCTURE_SERVICES`).

6. **State a canonical credential-encryption standard** (AES-256-GCM via
   `credentials-vault`) and note TrainChat as a known exception pending unification.

7. **Note that the `IntegrationType` union is forward-declared.** Document that
   `claude`, `hubspot`, `discord`, `meta_ads`, and `custom_webhook` are placeholders
   without executors, so future contributors don't assume they work.

These updates preserve `CLAUDE.md`'s role as the canonical architectural reference
while reconciling it with verified implementation.

---

## Files Reviewed

| File | Notes |
|---|---|
| `package.json` | Dependency inventory (stripe, openai, googleapis, twilio, composio-core, @sendgrid/mail, @google-cloud/storage, openid-client) |
| `server/stripeClient.ts` | Stripe client + Connectors + StripeSync |
| `server/webhookHandlers.ts` | Stripe webhook events, idempotency, per-org Connect |
| `server/connectors/stripe-invoicing.ts` | Agent invoicing |
| `server/index.ts` | Stripe webhook route, startup validation |
| `server/phase10-routes.ts` | Marketplace webhook |
| `server/email.ts` | SendGrid client + Replit Connectors fallback + inbound |
| `server/services/agentmail-service.ts` | AgentMail REST client, inboxes, send |
| `server/services/agentmail-send-guard.ts` | AgentMail policy gate |
| `server/services/agentmail-inbound-router.ts` | Inbound classification/routing |
| `server/agentmail-routes.ts` | AgentMail webhook + routes |
| `server/services/gmail-agent-service.ts` | Gmail API client, OAuth token refresh |
| `server/integrations/gmail.ts` | Gmail runtime wrapper |
| `server/services/gmail-sync-state.ts` | Gmail sync cron state |
| `server/connectors/google-calendar.ts` | Calendar via direct REST + `connector_tokens` |
| `server/integrations/google-calendar.ts` | Calendar via `googleapis` + `external_integrations` |
| `server/ai-model-runtime.ts` | OpenAI/OpenRouter provider abstraction + AI logging |
| `server/integrations/openrouter.ts` | Model routing tiers, Anthropic fallbacks |
| `server/integrations/research-agent.ts` | OpenAI web-search research |
| `server/replit_integrations/auth/replitAuth.ts`, `storage.ts` | Replit OIDC |
| `server/replit_integrations/object_storage/objectStorage.ts`, `objectAcl.ts` | GCS via sidecar + ACL |
| `server/replit_integrations/audio/client.ts`, `image/client.ts`, `chat/routes.ts` | Replit AI |
| `server/replit_integrations/batch/utils.ts` | Batch concurrency/retry |
| `server/credentials-vault.ts` | AES-256-GCM credential vault |
| `server/integration-runtime.ts` | Governed execution + IntegrationType union |
| `server/services/integration-status-service.ts` | Status resolution, INFRASTRUCTURE_SERVICES |
| `server/integrations-routes.ts` | TrainChat connect/test/disconnect API |
| `server/services/composio-service.ts` | Composio REST client |
| `server/composio-tool-registry.ts` | Tool/action whitelist incl. GITHUB, SLACK, STRIPE |
| `server/composio-action-adapter.ts`, `composio-*-routes.ts`, `composio-hermes-emitter.ts` | Composio approval flows + Hermes events |
| `server/integrations/slack.ts` | Slack bot token / webhook posting |
| `server/meta-capi.ts`, `server/meta-book-capi.ts`, `server/meta.ts` | Meta CAPI (+ OG tags) |
| `client/src/lib/meta-pixel.ts`, `client/src/hooks/use-meta-capi.ts` | Client pixel + event dedup |
| `server/sms.ts` | Twilio SMS client, consent, templates |
| `server/services/obsidian-service.ts` | Obsidian REST transport |
| `server/services/trainchat-client.ts` | TrainChat REST client + encryption + OpenAI fallback |
| `docs/_template.md`, `docs/documentation-status-legend.md`, `docs/version-2-roadmap.md` | Structure/compliance |
| `docs/schema.md`, `docs/core-services.md`, `docs/agent-catalog.md` | Cross-reference |

**Verification methods:** dependency inventory (`package.json`); env-var sweep
(`grep -rhoE "process\.env\.[A-Z0-9_]+"`); SDK import grep; per-cluster direct file
reads; negative-confirmation greps for `@anthropic-ai/sdk` (absent), `composio-core`
imports (absent), and `hubspot`/`discord`/`meta_ads`/`custom_webhook` executors (absent).

---

## Confidence Assessment

**Overall confidence: High.**

- **Verified (High):** package dependencies, environment variables, credential
  mechanisms, transport (SDK vs raw REST), webhook routes and their auth, and the
  shared framework (`integration-runtime`, `credentials-vault`,
  `integration-status-service`) — all read directly from source.
- **Verified-negative (High):** absence of a direct Anthropic SDK, the unused
  `composio-core` package, and the non-implementation of `hubspot` / `discord` /
  `meta_ads` / `custom_webhook` / direct GitHub — confirmed by targeted greps over
  `server/integrations/`, `server/connectors/`, and env usage.

**Limits on confidence:**
- Some line numbers in supporting analysis came from agent-assisted reads; **function
  names, env vars, file paths, table names, and endpoint URLs** were the primary
  citation basis and are stable.
- The exact set of Stripe webhook event subtypes and the full transactional-email
  function list were cross-referenced against `docs/core-services.md` rather than
  re-enumerated here (by design — those belong to that document).
- Provider-side API versions (e.g., AgentMail v0 outbound returning 404) reflect
  source comments and code paths as of 2026-06-28 and may change provider-side.

---

## Last Updated

Date: 2026-06-28

Author: Engineering (generated from source — Verified Against Source)

Version: 1.0
