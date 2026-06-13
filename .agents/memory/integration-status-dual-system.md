---
name: Integration Status Dual-System Fix
description: Two independent integration status systems existed causing inconsistency; unified via a single service.
---

# Problem
Two completely independent integration status systems existed:

**System A — `makeIntegrations()` (lines ~26918 in routes.ts)**
- Detects status via **env vars** (`GOOGLE_CLIENT_SECRET`, `SENDGRID_API_KEY`, `STRIPE_SECRET_KEY`, etc.)
- Used by: `/api/integrations/overview`, `/api/integrations/category/:cat`, `/api/integrations/tool-registry`
- Used by pages: admin-integrations.tsx (Integrations tab)
- Correctly showed Gmail = connected when OAuth env vars are present

**System B — `external_integrations` DB table**
- Queried directly via `storage.getExternalIntegrations(orgId)`
- Used by: `/api/integrations/stats`, `/api/workforce/health`, recommendation-engine.ts, org-ai-infrastructure.ts
- Showed 0 connected when no DB rows existed with `status = "connected"`
- Caused false "No communication integrations connected" recommendation

# Fix
Created `server/services/integration-status-service.ts` — single source of truth:
- `getEffectiveConnectedIntegrations(orgId)` → checks DB first, falls back to env vars
- `INFRASTRUCTURE_SERVICES` Set — Hermes, AgentMail, Obsidian never count as "disconnected"
- `COMMUNICATION_INTEGRATION_TYPES` — gmail, slack, sendgrid, twilio; ALL must be absent to fire the no-comms warning

**Why:** DB row wins when present. Env var is the fallback so pages are consistent even before OAuth is completed. Infrastructure runtime components (Hermes/AgentMail/Obsidian) must never appear in external integration missing-checks.

**How to apply:** Any new endpoint that needs integration connected/disconnected status MUST import from `server/services/integration-status-service.ts`, never call `storage.getExternalIntegrations()` directly for a status Set.

# Changed Locations (5 route edits + 2 service files)
- `server/recommendation-engine.ts` — uses `getEffectiveConnectedIntegrations()` + `COMMUNICATION_INTEGRATION_TYPES`
- `server/services/org-ai-infrastructure.ts` — uses `getEffectiveConnectedIntegrations()`
- `server/routes.ts` `/api/workforce/health` — unified count via service
- `server/routes.ts` `/api/workforce/readiness` — gmail/calendar/stripe via service
- `server/routes.ts` `/api/workforce/coverage-analysis` — gmailOn/calOn via service
- `server/routes.ts` `/api/admin/ai-infrastructure/activation-matrix` — connectedIntTypes via service
- `server/routes.ts` first-10/dashboard endpoint — connectedSet via service

# Integration classification
Infrastructure (never "disconnected"): hermes, agentmail, obsidian
External (env-var fallback): gmail, google_calendar, slack, stripe, sendgrid, twilio, hubspot, openrouter, meta_ads
Core (health penalty if missing): gmail, google_calendar, stripe
