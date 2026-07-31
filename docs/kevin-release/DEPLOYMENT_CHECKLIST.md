---
Document Type: Release / Deployment
Verification Status: Validated against source (Phases 0–2)
Last Reviewed: 2026-07-13
Owner: Platform Engineering + Kevin Ops
Scope: Kevin ↔ TrainEfficiency control-plane integration (BFF, admin-only)
Related:
  - docs/kevin-hermes-integration-architecture.md
  - docs/kevin-release/ROLLBACK.md
  - docs/kevin-release/RISKS_AND_LIMITATIONS.md
---

# Kevin Control Plane — Replit Deployment Checklist

This document is the operator runbook for deploying the Kevin integration (Phases
0–2) to the TrainEfficiency Replit app. It is **safe by default**: with no new
Secrets set, the integration stays fully OFF and the platform behaves exactly as it
did before this release.

> **Default-off guarantee.** `KEVIN_AGENT_INTEGRATION_ENABLED` (preferred) and
> legacy `KEVIN_INTEGRATION_ENABLED` default to `false`. Either truthy enables.
> Until enabled *and* the two Hermes Secrets are present, every `/api/kevin/*`
> route returns an `unconfigured`/`503` fail-safe response and no calls are made to
> Hermes.

---

## 1. Required Secrets & Environment Variables

### 1.1 New variables introduced by this release

| Name | Purpose | Required? | Consuming service / file | Expected format | Must stay server-side? |
|------|---------|-----------|--------------------------|-----------------|------------------------|
| `KEVIN_AGENT_INTEGRATION_ENABLED` | **Preferred** master feature flag. Turns the Kevin BFF / agent integration on. | Optional (defaults `false`) | `server/services/kevin-hermes-client.ts` → `resolveKevinIntegrationEnabled()` / `getKevinConfig()` | Boolean-ish: `true` / `1` / `yes` / `on` | Yes (server env only) |
| `KEVIN_INTEGRATION_ENABLED` | Legacy alias for the master flag (OR with preferred). | Optional (defaults `false`) | same | Same truthy set. Either flag enables. | Yes (server env only) |
| `KEVIN_HERMES_BASE_URL` | Base URL of the Hermes API Server (profile `kevin`). The BFF prefixes this to `/health`, `/v1/capabilities`, `/v1/runs`, etc. | **Required when enabled** | `server/services/kevin-hermes-client.ts` (`kevinFetch`, `hermesOpenRunEvents`) | Absolute URL, no trailing slash needed. Loopback/private preferred, e.g. `http://127.0.0.1:8642` or `https://kevin-ops.internal`. Only scheme+host is ever surfaced to the client (redacted). | Yes (server env only) |
| `KEVIN_HERMES_API_KEY` | Bearer token for the Hermes API Server. Sent as `Authorization: Bearer …`. **Must equal the `API_SERVER_KEY` configured on the kevin Hermes profile.** | **Required when enabled** | `server/services/kevin-hermes-client.ts` (all outbound Hermes calls) | Opaque high-entropy string (current ops value is 64 chars). No fixed prefix. | **Yes — never exposed to the browser, never logged, never returned by any route** |
| `KEVIN_REQUEST_TIMEOUT_MS` | Default TE→Hermes HTTP timeout (ms) for KevinHermesClient. | Optional (default `8000`) | `server/services/kevin-hermes-client.ts` → `getKevinRequestTimeoutMs()` | Integer ms; clamped 1000–120000. Run-create uses `max(30000, this)`. | Yes (server env only) |
| `KEVIN_CALLBACK_ALLOWED_SKEW_SECONDS` | Max clock skew for Kevin→TE callback HMAC timestamp check (`x-kevin-timestamp`). | Optional (default `300`) | `shared/kevin/outbound-hmac.ts` → `getKevinCallbackAllowedSkewSeconds()`; used by `verifyKevinCallbackHeaders` | Integer seconds; clamped 30–3600 | Yes (server env only) |
| `KEVIN_CALLBACK_BASE_URL` | TE public origin Kevin uses when POSTing async callbacks/webhooks to TE (no trailing slash). | Optional (default `https://app.trainefficiency.com`; also falls back to `TE_APP_BASE_URL` / `APP_BASE_URL`) | `shared/kevin/callback-base-url.ts` → `getKevinCallbackBaseUrl()` / `buildKevinCallbackUrl()`; re-exported from `kevin-outbound-auth.ts` | Absolute `https://…` URL, no path required. **Not** `KEVIN_HERMES_BASE_URL`. | No (public origin) |
| `KEVIN_CALLBACK_HMAC_SECRET` | Shared HMAC for **Kevin → TE** callbacks/webhooks (`x-kevin-timestamp` + `x-kevin-signature` v1). **Preferred Replit name.** | Required when Kevin→TE webhook/callback routes are enabled; optional for Phases 0–2 Console-only | `shared/kevin/outbound-hmac.ts`, `server/services/kevin-outbound-auth.ts` | Opaque high-entropy string (64 hex chars ops default). Same value as `KEVIN_OUTBOUND_HMAC_SECRET` and legacy `TRAINEFFICIENCY_KEVIN_SIGNING_SECRET`. | **Yes — server only** |
| `KEVIN_OUTBOUND_HMAC_SECRET` | Alternate alias for callback HMAC (identical value). | Optional if `KEVIN_CALLBACK_HMAC_SECRET` set | same as above (fallback) | Must match callback secret when both present | **Yes — server only** |
| `TRAINEFFICIENCY_KEVIN_SIGNING_SECRET` | Legacy alias for callback HMAC (identical value). | Optional if preferred name set | same as above (fallback) | Must match when present | **Yes — server only** |
| `TE_INTERNAL_SERVICE_TOKEN` | Separate bearer for Kevin→TE internal service auth (not the HMAC secret). | Optional until callback routes require it | `server/services/kevin-outbound-auth.ts` | Opaque high-entropy string | **Yes — server only** |

### 1.2 Existing platform variables Kevin depends on (already configured — verify only)

| Name | Purpose for Kevin | Required? | Consuming service / file | Notes |
|------|-------------------|-----------|--------------------------|-------|
| `DATABASE_URL` | Kevin's `kevin_audit_events`, `kevin_sessions`, `kevin_runs` tables self-provision here on first use. | Required (already set) | `server/db.ts` via `server/services/kevin-*.ts` | No new DB provisioning step; tables are created idempotently via `CREATE TABLE IF NOT EXISTS`. |
| `NODE_ENV` | Stamped into the Kevin invocation context passed to Hermes runs (`environment` field). | Required (already set) | `server/services/kevin-context-builder.ts` | Set to `production` in the Replit deployment. |
| Session/OIDC auth secrets (Replit Auth) | `isAuthenticated` gate on every Kevin route. | Required (already set) | `server/replit_integrations/auth` | Unchanged by this release. |

### 1.3 Variables that must **NOT** be added to TrainEfficiency

These belong to the Hermes host **only** and must never appear in Replit Secrets:

- `API_SERVER_KEY` (Hermes side; TE mirrors its value as `KEVIN_HERMES_API_KEY`)
- Model provider keys: `OPENAI_API_KEY`, `XAI_API_KEY`, Anthropic/OpenRouter keys, etc.
- Any Orgo / Slack / AgentMail / Composio credentials used by Kevin's tools

> Rationale: TE never runs models or Kevin's tools; it only speaks to the Hermes API
> Server. Keeping model/tool credentials off the TE host preserves the trust boundary.

---

## 2. Pre-Deployment Checklist

- [ ] Confirm the Hermes API Server (profile `kevin`) is running and reachable from the
      Replit deployment's network (loopback, private network, Tailscale, or tunnel).
- [ ] Confirm `API_SERVER_KEY` is set on the Hermes profile and note its value for
      mirroring.
- [ ] In **Replit → Secrets**, add:
      - [ ] `KEVIN_HERMES_BASE_URL` (Hermes API Server URL)
      - [ ] `KEVIN_HERMES_API_KEY` (equal to Hermes `API_SERVER_KEY`)
      - [ ] Leave `KEVIN_INTEGRATION_ENABLED` **unset** for the first deploy (stays off).
- [ ] Verify no `.env.kevin.local` or other local secret file is included in the deploy
      bundle (it is git-ignored; confirm it is not present in the Replit filesystem).
- [ ] Confirm the deploying user has an `ADMIN` role in `user_profiles` (only ADMIN can
      reach the Kevin Console).

## 3. Deployment Steps

1. [ ] Merge the release PR (`feature/kevin-control-plane-release`) into the main branch
       **after** review sign-off (do not merge as part of this audit).
2. [ ] Deploy on Replit as normal (`npm run build` → `npm start`). No `db:push` /
       migration step is required — Kevin tables self-provision.
3. [ ] Smoke test with the integration still **off**:
       - [ ] Log in as ADMIN → open **Kevin Console** (`/admin/kevin`).
       - [ ] Confirm status shows `unconfigured` and no errors are thrown.
       - [ ] Confirm a non-ADMIN user gets `403` on `/api/kevin/*` (no Console link shown).
4. [ ] Enable the integration:
       - [ ] Set `KEVIN_INTEGRATION_ENABLED=true` in Replit Secrets and restart.
5. [ ] Post-enable verification:
       - [ ] Kevin Console **Connection status** shows `healthy` (or `degraded` with a
             clear `lastError`); endpoint shows only the redacted `scheme://host`.
       - [ ] **Capabilities** card populates from Hermes `/v1/capabilities`.
       - [ ] Send one ops-chat message; confirm SSE deltas stream and a row appears under
             **Recent runs** and **Audit**.
       - [ ] Confirm `KEVIN_HERMES_API_KEY` does not appear in any response body, network
             tab, or client bundle (search the served JS for the key — must be absent).

## 4. Post-Deployment Verification (security spot-checks)

- [ ] `GET /api/kevin/health` as ADMIN returns redacted `baseUrlRedacted` only (no key,
      no full internal URL/path).
- [ ] `GET /api/kevin/*` as COACH/CLIENT returns `403 KEVIN_ADMIN_ONLY`.
- [ ] Stopping Hermes and reloading the Console shows a graceful `down`/`degraded`
      state — the rest of the TrainEfficiency app remains fully functional.
- [ ] `kevin_audit_events` contains entries for capabilities reads and run lifecycle.

## 5. Disable / Kill-Switch (no redeploy required)

Set `KEVIN_INTEGRATION_ENABLED=false` (or remove it) and restart. All `/api/kevin/*`
routes immediately return `unconfigured`/`503`; no Hermes calls are made. See
`ROLLBACK.md` for full rollback.
