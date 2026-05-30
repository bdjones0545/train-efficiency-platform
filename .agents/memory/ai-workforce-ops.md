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

## Endpoints (Phase 4)

| Endpoint | Purpose |
|---|---|
| `GET /api/workforce/optimization-recommendations` | Evidence-based recs; reads memory to skip rejected items |
| `GET /api/workforce/business-health` | Composite 0–100 score across 8 components |
| `GET /api/workforce/forecast?window=` | 7d/30d/90d linear projection (expected/best/worst) |
| `GET /api/workforce/workflow-effectiveness` | Per-workflow success rate, hours saved, ROI |
| `GET /api/workforce/executive-insights` | Atlas Q&A: focus today, costs, gains, risks, opportunities |
| `GET /api/workforce/intelligence-scorecard` | Recommendation acceptance rate, opportunity conversion, etc. |
| `GET /api/workforce/memory` | Organizational memory list (decisions, outcomes) |
| `POST /api/workforce/memory` | Upsert memory entry by (orgId, key) — auto-records learning event |
| `POST /api/workforce/learning-events` | Record learning event |
| `GET /api/workforce/learning-events` | List recent learning events |

## Pages (Phase 4)

| Route | File |
|---|---|
| `/admin/ai-workforce/optimization` | `admin-ai-workforce-optimization.tsx` — 5-tab Strategic Command Center |
| `/admin/ai-workforce/approvals` | `admin-ai-workforce-approvals.tsx` — Approve/Reject/Defer with memory history |

## Tables

| Table | Phase | Purpose |
|---|---|---|
| `org_ai_workforce_settings` | 1 | Wizard config |
| `org_ai_workforce_audit_log` | 2 | Config change history |
| `org_ai_workforce_outcomes` | 3 | Evidence-based outcome records |
| `org_ai_opportunities` | 3 | AI-identified opportunities (open/in_progress/resolved/expired) |
| `org_ai_learning_events` | 4 | Immutable learning signals (accepted/rejected/deferred/success/failure) |
| `org_ai_workforce_memory` | 4 | Org memory; unique on (org_id, key); 30-day TTL; prevents repeat recs |

## Endpoints (Phase 5)

| Endpoint | Purpose |
|---|---|
| `GET /api/workforce/executions` | List all execution plans (sorted desc) |
| `POST /api/workforce/executions` | Create execution plan from recommendation — auto-seeds approval rules |
| `PATCH /api/workforce/executions/:id` | Approve or reject a plan (`action: "approve"\|"reject"`) |
| `POST /api/workforce/executions/:id/run` | Execute an approved plan (simulated, records outcome) |
| `POST /api/workforce/simulate` | Dry-run simulation — no real actions, returns projections |
| `GET /api/workforce/trust` | Trust score 0–100 + tier + governance recommendation |
| `GET /api/workforce/performance-reviews` | Per-agent performance reviews with grades (A+…F) |
| `GET /api/workforce/coo-dashboard` | COO dashboard: pipeline, ROI, trust, top agents |
| `GET /api/workforce/approval-rules` | Org approval rules — auto-seeds defaults on first call |
| `PUT /api/workforce/approval-rules/:id` | Update a specific approval rule |
| `GET /api/workforce/experiments` | List A/B experiments |
| `POST /api/workforce/experiments` | Create experiment |
| `GET /api/workforce/workflow-optimization` | Workflow optimization recs (triggers learning engine) |
| `GET /api/workforce/learning-improvements` | Self-improvement analysis + learning insights |
| `GET /api/workforce/governance-recommendations` | Governance recs based on trust tier |

## Pages (Phase 5)

| Route | File |
|---|---|
| `/admin/ai-workforce/executions` | `admin-ai-workforce-executions.tsx` — Agent Action Center, 5 tabs |
| `/admin/ai-workforce/simulator` | `admin-ai-workforce-simulator.tsx` — Dry-run safety preview |

## Tables (Phase 5)

| Table | Purpose |
|---|---|
| `org_ai_execution_plans` | Source of truth for every workforce action — full audit trail |
| `org_ai_approval_rules` | Governance rules; auto-seeded with 4 defaults per org on first use |
| `org_ai_experiments` | A/B testing framework for workflows, messages, cadences |
| `workflow_optimization_recs` | Workflow improvement suggestions (no auto-modify) |
| `agent_templates` | Internal marketplace foundation — not exposed publicly yet |

## Key Phase 5 decisions

- **Financial actions always supervised** — `revenue` and `governance` categories bypass auto-approve unconditionally.
- **Execution engine is simulated** — `executeApprovedPlan()` records outcomes (85% success rate model) but does not yet wire into live workflow triggers. Future: hook into workflowJobs.
- **Trust tiers**: Emerging (0–20) → Developing (21–40) → Trusted (41–60) → Highly Trusted (61–80) → Autonomous Ready (81–100).
- **Default approval rules seeded**: low = auto_approve, medium/high/critical = requires_approval; seeded once per org.
- **`Zap` icon** is already imported in `admin-ai-workforce.tsx` (needed for Execute nav button).

## How to apply

- Attribution engine is on-demand — no cron needed; all endpoints import it dynamically.
- Time savings use `TIME_BENCHMARKS` constants in the engine (minutes per action type). Hourly rate = $35.
- All Phase 3–5 routes use dynamic `await import(...)` for engine files.
- New pages go near the `/admin/ai-workforce` route block in App.tsx.
- Approval rules must be seeded before execution plan creation — call `seedDefaultApprovalRules(orgId)` first.
