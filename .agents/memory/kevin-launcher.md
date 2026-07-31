---
name: Kevin Launcher + Inbox
description: How the Kevin FAB/drawer, /api/kevin/inbox, chat blocks-SSE, and nav registry fit together; gotchas.
---

# Kevin Launcher (chat-widget.tsx)

- The single admin/coach FAB is `client/src/components/chat-widget.tsx` — rewritten as the Kevin launcher with EXACTLY two tabs: Kevin Chat + Kevin Inbox. `CoachAgentLauncher` was unmounted from App.tsx (file still exists, unused). `ClientAgentLauncher` (CLIENT role) remains.
- **Never call wouter `setLocation` inside the portal-rendered drawer** — use `window.location.assign(route)` for all navigation from inside it.
- Chat SSE protocol: `data: {"content": ...}` for text; `data: {"blocks": {navigation: [...]}}` for structured blocks. Server side: orchestrator yields `BLOCKS_SENTINEL + JSON` as ONE generator chunk; /api/chat detects `chunk.startsWith(BLOCKS_SENTINEL)`. Safe because /api/chat iterates the AsyncGenerator directly (chunk boundaries preserved, no byte-stream fragmentation).
- Navigation suggestions come from `navSuggestionsFor()` in ceo-agent-orchestrator, validated against `server/services/kevin-navigation-registry.ts`. **Every registry route must exist as an exact `Route path=` in client/src/App.tsx** — a validation one-liner:
  `for r in $(grep -oP 'route: "\K[^"]+' server/services/kevin-navigation-registry.ts | sort -u); do grep -q "path=\"$r\"" client/src/App.tsx || echo MISSING: $r; done`
  **Why:** 8 registry routes were dead (e.g. /admin/integrations → real page is /admin/configuration; /admin/attention-inbox → /admin/attention; /command-center is a redirect — use /admin/command-center).
- `/api/kevin/inbox` (server/kevin-inbox-routes.ts) is read-only aggregation, org-scoped via resolveOrgIdOrThrow; mutations stay on existing gated endpoints (/api/ai-approvals/:id/approve|reject, /api/agentmail/followups/:id/*).

# Org isolation lessons

- Admin-facing Kevin endpoints must resolve org server-side (profile lookup), never from query/body: fixed /api/kevin/audit (was unfiltered), and the org-capability-settings GET/PUT/seed in kevin-emergency-routes (trusted body/query org_id).
- The `/api/internal/kevin/v1/*` service-token API legitimately takes org_id from payload — the HMAC/internal token is the trust boundary there.
- `admin-kevin.tsx` org-capability-settings panel must use snake_case row fields (capability_key, execution_mode, enabled) and PUT to `/org-capability-settings/:capabilityKey`, passing ALL fields (server PUT overwrites unspecified fields with defaults).
