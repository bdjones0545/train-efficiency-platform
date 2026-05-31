---
name: CEO Heartbeat + Agent Operating System
description: Unified orchestration layer — coordinates all agents, adds execution locks/idempotency, completes outcome feedback loop, CEO dashboard.
---

## Tables (created via executeSql, also declared in shared/schema.ts)
- `ceo_heartbeat_runs` — one row per orchestration cycle (status, agentsCoordinated, durationMs, triggeredBy, idempotencyKey)
- `job_execution_locks` — distributed locks keyed by jobKey, with expiresAt for TTL
- `agent_operating_timeline` — unified event stream: every agent action, approval, outcome, and error
- `admin_action_audit_log` — every human approval, rejection, and system configuration change

## Services
- `server/services/ceo-heartbeat-service.ts` — orchestrator: coordinates 7 agent systems, calculates priorities, manages locks, writes timeline, runs every 30 min via setInterval
- `server/services/outcome-bridge-service.ts` — bridges reply detection / booking / deal stage change events into agentCommunicationOutcomes

## Routes
- `server/ceo-heartbeat-routes.ts` — 9 endpoints registered in registerRoutes() in server/routes.ts
  - GET /api/admin/ceo-heartbeat/status
  - POST /api/admin/ceo-heartbeat/run
  - GET /api/admin/ceo-heartbeat/timeline
  - GET /api/admin/ceo-heartbeat/priorities
  - GET /api/admin/ceo-heartbeat/health
  - POST /api/admin/ceo-heartbeat/pause
  - POST /api/admin/ceo-heartbeat/resume
  - POST /api/admin/ceo-heartbeat/retry-failed
  - POST /api/admin/ceo-heartbeat/recalculate-priorities
  - GET /api/admin/ceo-heartbeat/audit-log
  - GET /api/admin/ceo-heartbeat/locks
  - GET /api/admin/ceo-heartbeat/runs

## Frontend
- Page: `client/src/pages/admin-ceo-heartbeat.tsx` at `/admin/ceo-heartbeat`
- Sidebar nav: "CEO Heartbeat" in AI Intelligence group (app-sidebar.tsx)
- Cron startup: server/index.ts calls `startCeoHeartbeat()` + delayed `runHeartbeatForAllOrgs("startup")` after 3 min

## Key schema gotchas
- `teamTrainingDeals` uses `organizationId` (not `orgId`) and `status` (not `stage`); no `dealName` column
- `outcome-intelligence-routes.ts` imports auth from `./replit_integrations/auth` (not `./replitAuth`)

**Why:** Centralizing all agent coordination in one heartbeat prevents duplicate execution, provides a unified audit trail, and makes the priority ranking cross-system rather than per-agent-silo.

**How to apply:** When adding a new agent system, register it in `runHeartbeatCycle()` in ceo-heartbeat-service.ts and write timeline events via `writeTimeline()`.
