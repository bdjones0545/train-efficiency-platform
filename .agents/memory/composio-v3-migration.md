---
name: Composio SDK v3.1 Migration
description: composio-core@0.5.39 is permanently dead (v1 API 410 Gone); service rewritten to use direct HTTP against v3.1 API.
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

## Execute Endpoint Body Shape

```json
{
  "arguments": { ...tool-specific params },
  "entity_id": "org-scoped-identifier",
  "connected_account_id": "optional-if-entity_id-given"
}
```

Note: field is `arguments` not `input` or `inputParams`. Using `input` causes a 400 with message about `text.arguments` conflict.

## Tool Slugs

Tool slugs in v3.1 match the old v1 names exactly:
- `GMAIL_CREATE_EMAIL_DRAFT`
- `SLACK_SEND_MESSAGE`
- `GITHUB_CREATE_ISSUE`
etc.

## Connected Accounts

As of 2026-06-16: 0 connected accounts in the Composio dashboard. Execution will return a 400 until the user connects Gmail/Slack/GitHub accounts at https://app.composio.dev/

## entityId Multi-Tenancy

For org-scoped execution, pass `entity_id: orgId` in the execute body. This maps to the Composio entity that holds connected accounts for that org. Currently all orgs share "default" entity — a per-org entity strategy is a future enhancement.
