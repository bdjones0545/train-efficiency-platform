---
name: Decision Journal Auto-Capture
description: DB-backed system that automatically records every major platform decision into decision_journal_entries table; wired into 5 capture points; full Decisions tab redesign.
---

## Rule
Every major platform decision (approvals, rejections, agent executions, recommendations, reply classifications) is auto-captured into the `decision_journal_entries` table. Manual entries are secondary/optional.

**Why:** Previously the Decisions tab only showed seed data + Hermes learnings filtered by memoryType="decision". This meant no real decisions were being recorded automatically, making the journal useless for auditability.

**How to apply:** Any new approval/rejection/agent-execution path that should be auditable should call the appropriate convenience wrapper from `server/services/decision-journal-service.ts` inside a fire-and-forget `try { ... } catch (_) {}` block — never block the main request path.

## Key files
- `server/services/decision-journal-service.ts` — full service: `ensureDecisionJournalTable()`, `recordDecision()`, plus 5 convenience wrappers (recordWorkflowDecision, recordGmailDecision, recordHeartbeatDecision, recordRecommendationDecision, recordReplyClassificationDecision), and query functions (getDecisions, searchDecisions, countDecisions, getDecisionStats).
- `client/src/pages/admin-organizational-memory.tsx` — Decisions tab redesigned with KPI row (8 stats), source-type filter tabs, search bar, rich DecisionCard components, and ManualDecisionForm behind a button.

## Wiring points (5 capture sources)
1. **workflow** — approve (`POST /api/workflow-runs/:id/approve`) and reject routes in routes.ts
2. **gmail** — approve, reject, edit-approve routes in routes.ts
3. **ceo_heartbeat** — wired at end of `runHeartbeatCycle()` in `server/services/ceo-heartbeat-service.ts`
4. **executive_agent / recommendation** — executive recommendations action + recommendations accept routes in routes.ts
5. **reply_classification** — reply classification route in routes.ts

## Backend endpoints (4 new)
- `GET /api/organizational-memory/decisions` — replaced to use `getDecisions()` from service (supports sourceType, agent, decisionType, limit, offset query params)
- `GET /api/organizational-memory/decisions/stats` — KPI summary (total, agentDecisions, humanDecisions, approvalCount, rejectionCount, avgConfidence, last7DaysCount, bySourceType, byAgent, byDecisionType)
- `GET /api/organizational-memory/decisions/search` — full-text search via `searchDecisions()`
- `POST /api/organizational-memory/decisions/record` — manual entry

## Table schema
`decision_journal_entries` created lazily via `ensureDecisionJournalTable()` on first use (not in Drizzle schema — uses `db.execute(sql`...`)` pattern like other late-added tables). Fields: id, org_id, agent, source_type, source, decision, reasoning, outcome, follow_up, confidence, decision_type, department, related_entity_type, related_entity_id, metadata (jsonb), created_at, updated_at.
