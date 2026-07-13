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

> **Default-off guarantee.** `KEVIN_INTEGRATION_ENABLED` defaults to `false`. Until
> it is set to `true` *and* the two Hermes Secrets are present, every `/api/kevin/*`
> route returns an `unconfigured`/`503` fail-safe response and no calls are made to
> Hermes.

---

## 1. Required Secrets & Environment Variables

### 1.1 New variables introduced by this release

| Name | Purpose | Required? | Consuming service / file | Expected format | Must stay server-side? |
|------|---------|-----------|--------------------------|-----------------|------------------------|
| `KEVIN_INTEGRATION_ENABLED` | Master feature flag. Turns the Kevin BFF on. When not truthy, all `/api/kevin/*` endpoints return `unconfigured` and never contact Hermes. | Optional (defaults `false`) | `server/services/kevin-hermes-client.ts` → `getKevinConfig()`; read indirectly by all `server/kevin-routes.ts` handlers | Boolean-ish string: one of `true` / `1` / `yes` / `on` (case-insensitive) to enable; anything else = disabled | Yes (server env only) |
| `KEVIN_HERMES_BASE_URL` | Base URL of the Hermes API Server (profile `kevin`). The BFF prefixes this to `/health`, `/v1/capabilities`, `/v1/runs`, etc. | **Required when enabled** | `server/services/kevin-hermes-client.ts` (`kevinFetch`, `hermesOpenRunEvents`) | Absolute URL, no trailing slash needed. Loopback/private preferred, e.g. `http://127.0.0.1:8642` or `https://kevin-ops.internal`. Only scheme+host is ever surfaced to the client (redacted). | Yes (server env only) |
| `KEVIN_HERMES_API_KEY` | Bearer token for the Hermes API Server. Sent as `Authorization: Bearer …`. **Must equal the `API_SERVER_KEY` configured on the kevin Hermes profile.** | **Required when enabled** | `server/services/kevin-hermes-client.ts` (all outbound Hermes calls) | Opaque high-entropy string (current ops value is 64 chars). No fixed prefix. | **Yes — never exposed to the browser, never logged, never returned by any route** |

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
