---
name: Composio SDK v3.1 Migration
description: composio-core@0.5.39 is permanently dead (v1 API 410 Gone); service rewritten to use direct HTTP against v3.1 API. E2E validated live 2026-06-16.
---

# Composio SDK v3.1 Migration

## The Rule
Never use `composio-core` or `@composio/core` SDKs. Call the Composio REST API directly.

**Why:** `composio-core@0.5.39` called `https://backend.composio.dev/api/v1/*` which is permanently removed (HTTP 410). The new SDK `@composio/core@0.10.0` uses `@composio/client` internally which hits `v3.1`. Rather than pin to another SDK that may break again, the service layer uses native `fetch` against the stable v3.1 HTTP API directly.

**How to apply:** All Composio calls go through `server/services/composio-service.ts` only. No agent or route may import `composio-core` or call Composio directly.

## v3.1 API Endpoints (confirmed working)

Base URL: `https://backend.composio.dev`
Auth header: `x-api-key: {COMPOSIO_API_KEY}`

| Purpose | Method | Path |
|---------|--------|------|
| Health check | GET | `/api/v3.1/toolkits?limit=1` |
| List toolkits | GET | `/api/v3.1/toolkits?limit=100` |
| List tools for app | GET | `/api/v3.1/tools?toolkit_slug={slug}&limit=N` |
| List connected accounts | GET | `/api/v3.1/connected_accounts?limit=50` |
| Execute tool | POST | `/api/v3.1/tools/execute/{TOOL_SLUG}` |

## Execute Endpoint Body Shape (CRITICAL)

```json
{
  "arguments": { ...tool-specific params },
  "entity_id": "pg-test-d5dbc07d-...",
  "connected_account_id": "ca_eJZ6fmx6OSTa"
}
```

**Both `entity_id` AND `connected_account_id` are REQUIRED together.** Omitting either causes a 400: "User ID is required with connected account."

- `entity_id` is the Composio-internal `user_id` stored on each connected account (NOT "default").
- `connected_account_id` is the `ca_*` ID for the specific app (gmail, slack, etc).
- `composio-service.ts` auto-resolves both via `getConnectedAccountByToolkit(toolkitSlug)` which calls `listConnectedAccounts()` and returns `{ id, entity }`.

Note: body field is `arguments` not `input` or `inputParams`.

## v3.1 Connected Account Response Shape

The v3.1 API nests toolkit info under `toolkit.slug` (not a flat `toolkit_slug` field):

```json
{
  "id": "ca_eJZ6fmx6OSTa",
  "toolkit": { "slug": "gmail" },
  "user_id": "pg-test-d5dbc07d-e4b9-40d4-a024-8f1ddf8c1edf",
  "status": "ACTIVE"
}
```

`listConnectedAccounts()` maps this correctly:
- `toolkit_slug`: `a.toolkit?.slug ?? a.toolkit_slug ?? ...`
- `entity`: `a.user_id ?? a.entity ?? ...`

## Tool Slugs (confirmed via /api/v3.1/tools?search=...)

- Gmail: `GMAIL_CREATE_EMAIL_DRAFT`
- Slack: `SLACK_SEND_MESSAGE` (NOT `SLACK_SENDS_A_MESSAGE_TO_A_SLACK_CHANNEL` — old slug returns 404)
- GitHub: `GITHUB_CREATE_ISSUE`

Slack action params: `{ channel: "#channel-name", markdown_text: "message" }` (NOT `text`).

## Connected Accounts (as of 2026-06-16)

| ID | Toolkit | Status | Entity |
|----|---------|--------|--------|
| ca_YdIaydtQqpvt | github | ACTIVE | pg-test-d5dbc07d-e4b9-40d4-a024-8f1ddf8c1edf |
| ca_eJZ6fmx6OSTa | gmail | ACTIVE | pg-test-d5dbc07d-e4b9-40d4-a024-8f1ddf8c1edf |
| ca_RZO_DbzEN-Lf | googlecalendar | ACTIVE | pg-test-d5dbc07d-e4b9-40d4-a024-8f1ddf8c1edf |
| ca_3ZmeRUnJiJXi | slack | ACTIVE | pg-test-d5dbc07d-e4b9-40d4-a024-8f1ddf8c1edf |

## Auth Bug Fixed (2026-06-16)

All Composio routes used `req.user?.orgId` which returns null for Bearer token auth. Fixed to use `resolveOrgIdOrThrow(req)` from `server/lib/resolve-org-id.ts` in all three route files: `composio-routes.ts`, `composio-gmail-draft-routes.ts`, `composio-slack-alert-routes.ts`.

## E2E Validation Results (2026-06-16)

- Gmail draft flow: ✅ LIVE — `GMAIL_CREATE_EMAIL_DRAFT` → Draft ID `r-6954490872583253049` created in connected Gmail account
- Slack alert flow: ✅ LIVE — `SLACK_SEND_MESSAGE` → Message posted to `#general`
