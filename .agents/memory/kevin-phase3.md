---
name: Kevin Phase 3 Integration
description: Kevin persistent AI intelligence layer — Phase 3 DB tables, event worker, wire-ins, routes, and test gotchas.
---

## Tables (created 2026-07-14 via executeSql — NOT drizzle-kit push)
kevin_capabilities, kevin_events, kevin_signals, kevin_context_requests, kevin_outcomes, kevin_rate_limits

**Why executeSql:** drizzle-kit push attempted to rename existing tables to kevin_capabilities due to schema inference ambiguity. Always use raw executeSql for Kevin table creation in fresh deploys.

## Key service export shapes
- `NavEntry` uses `route` (not `path`) — `listNavEntriesForRole(role)` and `resolveNavSuggestion(opts)` are the main nav functions
- `APPROVAL_MODE_ORDER` = ["disabled", "observe", "recommend", "draft", "require_approval", "auto"]
- `requireInternalServiceToken` returns **503** (not 401) when `TE_INTERNAL_SERVICE_TOKEN` is not configured — token length < 24 chars returns 503 "Internal service endpoint unavailable"
- `routeKevinSignal` returns `{ ok: false, status: "rejected_loop", error: "Signal depth exceeded" }` for depth > 3 — check `status` field not `dropReason`

## Wire-in pattern (all non-blocking, fail-open)
```typescript
void (async () => {
  try {
    const { enqueueKevinEvent } = await import("./kevin-event-service");
    await enqueueKevinEvent({ ... });
  } catch {}
})();
```
Never place this IIFE after a `return` statement (dead code).

## Route registration
- All new Kevin Phase 3 routes are inside `registerKevinRoutes()` in `server/kevin-routes.ts`
- `registerKevinSignalRoutes()` is in `server/kevin-signal-routes.ts`, registered inline (not async)
- `startKevinEventWorker()` starts a 5-min interval loop — runs after route registration in routes.ts
- Kevin admin routes log: `[KevinEvents] event worker started (5-min interval)`

## Wire-in touchpoints (Phase 3)
- `server/services/decision-journal-service.ts` → `te.decision.recorded` event after INSERT
- `server/agentmail-reply-routes.ts` approve path → `recordAgentMailApproved` + `te.agentmail.reply.approved`
- `server/agentmail-reply-routes.ts` reject path → `recordAgentMailRejected` + `te.agentmail.reply.rejected`
- `server/services/outcome-intelligence-service.ts` `createOutcomeOnSend` → `te.communication.sent`
- `server/services/intelligent-lead-intake-service.ts` `runIntelligentLeadIntakePipeline` → `te.lead.intake.completed`
- `server/services/ceo-heartbeat-service.ts` → `requestKevinContext` before `coordinateAgents`

## Test file
`server/tests/kevin-integration.test.ts` — 23 tests, all pass with `npx tsx server/tests/kevin-integration.test.ts`
