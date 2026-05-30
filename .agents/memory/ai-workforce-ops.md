---
name: AI Workforce Operations Layer
description: Phase 2+3 backend endpoints, frontend pages, and architectural decisions for the AI Workforce operating system.
---

## Key architectural decisions

**No `getWorkforceAgents` storage method exists.** Agent lists always come from `listAgentIdentities()` (from `server/agent-identities.ts`) combined with `storage.isAgentEnabledForOrg()` per agent.

**Real agent stats source.** `/api/workforce/agent-stats/:agentId` uses `storage.getUnifiedActionLog(orgId, { actorType: agentId })`.

**`storage.getCapabilityPolicies(orgId)` exists** and returns per-agent policies. Used in health + capabilities endpoints.

**Audit log table.** `org_ai_workforce_audit_log` (schema + DB). Log entries via direct `db.insert()` inline in routes.

**attentionItems table** is named `attentionItems` (NOT `agentAttentionItems`). Status field uses `"active"` (not `"open"`). No `agentType` column — use `source` field instead.

**Attribution engine.** `server/workforce-attribution-engine.ts` — pure on-demand computation (no cron). Reads from `unifiedAgentActionLog`, `communicationLogs`, `bookings`, `aiRevenueEvents`. Returns per-agent and org totals.

**Why:**
- Phase 1: wizard setup. Phase 2: observable + configurable. Phase 3: economic impact layer with evidence-based attribution.

## Endpoints (Phase 2)

| Endpoint | Purpose |
|---|---|
| `GET /api/workforce/agent-stats/:agentId` | Real data from unified_agent_action_log |
| `GET /api/workforce/health` | System health: Healthy / Attention Needed / Critical |
| `GET /api/workforce/readiness` | 7-item readiness checklist |
| `GET /api/workforce/activity` | Unified feed: action log + pending approvals |
| `GET /api/workforce/scorecard?period=` | Org scorecard for today / 7d / 30d |
| `GET /api/workforce/settings` | Read org_ai_workforce_settings |
| `PUT /api/workforce/settings` | Update settings + reseed governance + write audit log |
| `GET /api/workforce/audit-log` | Configuration change history |
| `GET /api/workforce/capabilities` | Full agent capability matrix |
| `GET /api/workforce/recommendations` | Goal/preset intelligence recommendations |

## Endpoints (Phase 3)

| Endpoint | Purpose |
|---|---|
| `GET /api/workforce/revenue-attribution?period=` | Agent-level revenue attribution from ai_revenue_events |
| `GET /api/workforce/roi?period=` | ROI: revenue + labor savings per period |
| `GET /api/workforce/time-savings` | Today / month / all-time hours + $ saved |
| `GET /api/workforce/leaderboard?period=` | Agent rankings by value score, revenue, time, tasks, success |
| `GET /api/workforce/opportunities` | Open opportunities list |
| `PATCH /api/workforce/opportunities/:id` | Update opportunity status |
| `POST /api/workforce/opportunities/refresh` | Generate + persist new opportunities from live data |
| `GET /api/workforce/executive-summary` | CEO dashboard: perf, revenue, top opps, risks, snapshot score |
| `GET /api/workforce/outcomes/:outcomeId` | Single outcome evidence detail |
| `GET /api/workforce/benchmarks` | Month/quarter/year period comparison |
| `GET /api/workforce/report` | Monthly text report with all sections |

## Pages

| Route | File | Phase |
|---|---|---|
| `/admin/ai-workforce/settings` | `admin-ai-workforce-settings.tsx` | 2 |
| `/admin/ai-workforce/capabilities` | `admin-ai-workforce-capabilities.tsx` | 2 |
| `/admin/ai-workforce/activity` | `admin-ai-workforce-activity.tsx` | 2 |
| `/admin/ai-workforce/leaderboard` | `admin-ai-workforce-leaderboard.tsx` | 3 |
| `/admin/ai-workforce/outcomes` | `admin-ai-workforce-outcomes.tsx` | 3 |

## Tables

| Table | Phase | Purpose |
|---|---|---|
| `org_ai_workforce_settings` | 1 | Wizard config |
| `org_ai_workforce_audit_log` | 2 | Config change history |
| `org_ai_workforce_outcomes` | 3 | Evidence-based outcome records |
| `org_ai_opportunities` | 3 | AI-identified opportunities (open/in_progress/resolved/expired) |

## How to apply

- Attribution engine is on-demand — no cron needed; all endpoints import it dynamically.
- Time savings use `TIME_BENCHMARKS` constants in the engine (minutes per action type). Hourly rate = $35.
- All Phase 3 routes use `await import("./workforce-attribution-engine")` dynamically.
- New pages go near the `/admin/ai-workforce` route block in App.tsx.
