---
name: AI Workforce Operations Layer
description: Phase 2 backend endpoints, frontend pages, and architectural decisions for the AI Workforce operating system.
---

## Key architectural decisions

**No `getWorkforceAgents` storage method exists.** Agent lists always come from `listAgentIdentities()` (from `server/agent-identities.ts`) combined with `storage.isAgentEnabledForOrg()` per agent. Never call a hypothetical `storage.getWorkforceAgents()`.

**Real agent stats source.** `/api/workforce/agent-stats/:agentId` now uses `storage.getUnifiedActionLog(orgId, { actorType: agentId })` — the `actorType` field maps to the agentType string (e.g., `executive_agent`).

**`storage.getCapabilityPolicies(orgId)` exists** and returns per-agent policies. Used in health + capabilities endpoints.

**Audit log table.** `org_ai_workforce_audit_log` (schema + DB). Log entries via direct `db.insert()` — no storage wrapper method added; routes do it inline.

**Why:**
- Phase 1 stored wizard selections but nothing was observable or configurable post-wizard.
- Phase 2 makes the system measurable (real stats, scorecard, health) and reconfigurable (settings page + PUT endpoint that reseeds governance).

## Endpoints added (Phase 2)

| Endpoint | Purpose |
|---|---|
| `GET /api/workforce/agent-stats/:agentId` | Fixed — real data from unified_agent_action_log |
| `GET /api/workforce/health` | System health: Healthy / Attention Needed / Critical |
| `GET /api/workforce/readiness` | 7-item readiness checklist with completion % |
| `GET /api/workforce/activity` | Unified feed: action log + pending approvals merged |
| `GET /api/workforce/scorecard?period=` | Org scorecard for today / 7d / 30d |
| `GET /api/workforce/settings` | Read org_ai_workforce_settings |
| `PUT /api/workforce/settings` | Update settings + reseed governance + write audit log |
| `GET /api/workforce/audit-log` | Configuration change history |
| `GET /api/workforce/capabilities` | Full agent capability matrix |
| `GET /api/workforce/recommendations` | Goal/preset intelligence recommendations |

## Pages added (Phase 2)

| Route | File |
|---|---|
| `/admin/ai-workforce/settings` | `admin-ai-workforce-settings.tsx` |
| `/admin/ai-workforce/capabilities` | `admin-ai-workforce-capabilities.tsx` |
| `/admin/ai-workforce/activity` | `admin-ai-workforce-activity.tsx` |

## How to apply

- When adding new workforce backend endpoints, put them in the Phase 2 block near `return httpServer` in routes.ts.
- When adding new workforce pages, import + register in App.tsx near the existing `/admin/ai-workforce` route block.
- The settings PUT endpoint auto-reseeds governance if `governanceMode` changed — no manual reseed needed.
