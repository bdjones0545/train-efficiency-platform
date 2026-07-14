---
name: Kevin Executive Operations Layer
description: Phase 15 spec — typed capability registry, policy engine, durable intent model, task bus, versioned API, AgentMail/CEO bridges, emergency controls, upgraded console UI
---

## Key files
- `server/services/kevin-capability-registry.ts` — 30+ typed capabilities; exports: getCapabilityDefinition, listCapabilityKeys, listCapabilitiesByCategory, getCapabilityCategories, isModeSupported, approvalRequired, riskIndex, serializeCapability, CAPABILITY_REGISTRY
- `server/services/kevin-policy-engine.ts` — 15-check policy evaluator + kill switches; exports: activateGlobalKill, deactivateGlobalKill, isGlobalKillActive, setOrgKill, setCapabilityKill, getEmergencyStatus
- `server/services/kevin-task-bus.ts` — delegation bus (depth≤3, circular prevention); KNOWN_AGENTS export (Set of valid agent names)
- `server/services/kevin-intent-service.ts` — 13-state durable intent model
- `server/services/kevin-agentmail-bridge.ts` — Kevin→gmail_agent_actions (draft-only)
- `server/services/kevin-ceo-bridge.ts` — CEO analysis/decision/escalation
- `server/kevin-action-api-routes.ts` — versioned `/api/internal/kevin/v1/*` with replay guard; registered via registerKevinActionApiRoutes()
- `server/kevin-emergency-routes.ts` — kill switch endpoints + intent management + approval decisions; registered via registerKevinEmergencyRoutes()
- `migrations/0003_kevin_intent_tables.sql` — kevin_intents, kevin_intent_tasks, kevin_exec_approvals
- `client/src/pages/admin-kevin.tsx` — now has 12 tabs including Intents/Registry/Approvals/Emergency/AgentMail
- `tests/kevin-executive-operations.test.ts` — 31 tests (node:test runner, run via: npx tsx --test tests/kevin-executive-operations.test.ts)

## Rules
- All Kevin DB tables: raw SQL via executeSql/db.execute (never drizzle-kit push — it tries to rename existing tables)
- approvalRequired(key, riskLevel): returns true for unknown keys (safe default)
- critical-risk capabilities must NOT default to "auto" mode
- KNOWN_AGENTS is a Set; check membership before delegating
- requireInternalServiceToken returns 503 (not 401) when TE_INTERNAL_SERVICE_TOKEN is unset
- Routes registered INSIDE registerRoutes() in server/routes.ts (not server/index.ts)

**Why:** drizzle-kit push renamed existing Kevin tables during phase 3; always use raw SQL migration files for Kevin schema changes.
