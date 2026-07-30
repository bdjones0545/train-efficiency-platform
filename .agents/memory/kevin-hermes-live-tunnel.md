---
name: Kevin live tunnel is a Hermes agent server
description: How agent_jobs actually dispatch to Kevin's live gateway (Hermes /v1/runs), not the signed /tasks contract
---

**Rule:** Kevin's live gateway (KEVIN_GATEWAY_BASE_URL) is a Hermes agent API server — it exposes `/v1/health`, `/v1/capabilities`, `/v1/runs` (bearer `KEVIN_HERMES_API_KEY`) and 404s the signed `POST /tasks` contract. Dispatch flows through `dispatchKevinTask` which, on 404, falls back to `dispatchViaHermesRun` (kevin-hermes-dispatch.ts): strict-JSON prompt → create run → background-poll `hermesGetRun` every 10s (5-min window) → parse JSON → complete job (retention writes `retention_agent_analyses`, others store `agent_jobs.result_payload`).

**Why:** The /tasks HMAC contract was designed but Kevin's side never implemented it; only the Hermes run API is live. All 7 agents verified end-to-end (dispatch → run → completed+result) against the live tunnel on 2026-07-30 via `npx tsx server/scripts/kevin-live-agent-test.mts`.

**How to apply:**
- Completion writes must stay idempotent/terminal-safe: guarded `status NOT IN (terminal)` updates, `ON CONFLICT DO NOTHING` on retention insert — the signed webhook path can race the poller.
- `agent_jobs.status` enum has `running` (NOT `started`); `retention_risk_level` enum is low|moderate|high|critical (map model "medium" → "moderate").
- `reconcileInFlightHermesJobs()` (called in registerKevinAgentRoutes) resumes polling after restarts; jobs older than the window are timed out.
- Retention context queries must carry `organization_id` filters (multi-org users leak cross-org data otherwise). Real bookings columns: `start_at`/`status` (CONFIRMED/COMPLETED...), plans table is `organization_subscription_plans`, subs key is `user_subscriptions.user_id`.
- Generic org dispatch: `POST /api/agents/:agentId/tasks` + `GET /api/agents/:agentId/jobs` (kevin-agent-routes.ts); org snapshot from kevin-org-context-service.ts (best-effort blocks, null on failure).
