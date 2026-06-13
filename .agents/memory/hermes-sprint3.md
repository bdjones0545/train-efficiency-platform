---
name: Hermes Sprint 3 — Execution Layer & Unified Approval Center
description: Architecture decisions for Sprint 3 — execution engine, cross-agent coordination, conflict resolution, action center, hermes dashboard.
---

# Hermes Sprint 3 — Execution Layer

## Core architecture

**Unified Execution Engine** (`server/services/unified-execution-engine.ts`)
- Single `executeAction(actionId, payload)` entrypoint — dispatches by `payload.actionType`
- 8 execution types: follow_up, prospect_outreach, schedule_call, schedule_meeting, lead_recovery, workflow_trigger, escalation, internal_task
- `follow_up` → creates gmail_agent_actions draft (proposed, approval_required: true)
- `prospect_outreach` → creates gmail_agent_actions draft (proposed, medium risk)
- `lead_recovery` / `workflow_trigger` → calls orchestrator.start() with mapped templateKey
- `escalation` → inserts into attention_items (with ON CONFLICT DO NOTHING fallback)
- Every execution writes to `execution_events` table with start → complete latency

**DB tables created lazily (ensureExecutionTables on first call):**
- `execution_events` — all execution runs with status/latency/output/error
- `coordination_decisions` — every coordination check decision log
- `agent_action_registry` — active action dedup index (support_score incremented on merge)
- `conflict_alerts` — conflicts with severity, agentActions JSONB, resolution audit

**Cross-Agent Coordination** (`server/services/cross-agent-coordination-service.ts`)
- `checkCoordination(req)` → returns `{action: "created" | "deduplicated" | "merged", actionId?}`
- Dedup key: org_id + action_type + (gmail_thread_id OR prospect_id OR lead_id)
- If fewer than 1 specific identifier is set, coordination is skipped (can't dedup without context)
- support_score ≥ 3 → decision = "merged"; else "deduplicated"

**Action Conflict Resolution** (`server/services/action-resolution-engine.ts`)
- 4 conflict rules: send_vs_hold (high), follow_up_vs_pause (high), duplicate_recover (medium), escalation_vs_action (critical)
- `checkAndRecordConflict(orgId, [actionA, actionB])` → writes conflict_alert if conflict found
- `resolveConflict(id, resolution, resolvedBy)` → sets status='overridden'; human override always wins

## Endpoint registration
- `server/execution-routes.ts` registered in `server/index.ts` after hermes routes
- 11 endpoints total:
  - POST /api/actions/approve — dispatches to correct source system + calls executeAction()
  - POST /api/actions/reject — updates source table status
  - POST /api/actions/escalate — calls executeAction with type=escalation
  - POST /api/actions/execute — direct execution
  - GET  /api/executions — list all events
  - GET  /api/executions/metrics — aggregated success/latency/byType
  - GET  /api/executions/:id — single event
  - GET  /api/coordination/stats — dedup stats
  - GET  /api/conflicts — open conflict alerts
  - POST /api/conflicts/:id/resolve — human resolution
  - GET  /api/action-center/summary — combined pending counts + metrics for dashboard header

## Source system mapping in approval handler

| sourceSystem | Approval handler |
|---|---|
| hermes | records feedback + calls executeAction with hermesTypeToActionType() |
| autonomous_queue | updates autonomous_action_queue.status + calls executeAction with autoQueueTypeToActionType() |
| agentmail | updates agent_mail_reply_queue approval_status |
| gmail_agent | updates gmail_agent_actions.status |

**hermesTypeToActionType():** follow_up→follow_up, prospect_outreach→prospect_outreach, lead_recovery→lead_recovery, policy_review→escalation, approval_needed→internal_task, engineering_review→escalation

## Frontend pages
- `/admin/action-center` → `client/src/pages/admin-action-center.tsx` — 4 tabs (All/Hermes/AutoQueue/AgentMail), approve/reject/escalate/detail dialogs, conflict panel, recent executions
- `/admin/hermes` → `client/src/pages/admin-hermes.tsx` — 6 tabs (Overview/Recommendations/Feedback/Signals/Executions/Success Rates), Run Cycle button, health banner

## CEO Heartbeat
- New queries: `/api/executions/metrics` and `/api/action-center/summary`
- New "Execution Engine" card with 4 stats (Pending, Total Executed, Success Rate, Open Conflicts)
- Icon: Zap (not CheckCircle — CEO heartbeat uses CheckCircle2, not CheckCircle)

## Workflow template mapping
- lead_recovery → churn_risk_recovery
- follow_up → scheduling_recovery  
- prospect_outreach → inactive_prepaid_recovery

**Why:** These are the only 3 predefined templates in WORKFLOW_TEMPLATES. Other types (schedule_call, internal_task) don't trigger workflows.
