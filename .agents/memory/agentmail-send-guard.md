---
name: AgentMail Send Guard — Sprint 1 Integration Audit
description: Centralized safety gate for all AgentMail outbound sends; policy hierarchy and humanApproved flag semantics.
---

## Rule
Every call to `sendAgentEmail()` or `replyFromAgentInbox()` in agentmail-service.ts goes through `checkAgentMailSendPolicy()` before any API call is made. Blocked sends are logged to `outbound_email_audit_log` and return `{ ok: false, blocked: true }` — they never throw.

## Policy Hierarchy (in priority order)
1. `emergencyPauseEnabled = true` → **BLOCK** (hardest stop — affects everyone including humans)
2. `neverAutoSend = true` AND `humanApproved = false` → **BLOCK** (autonomous sends disabled)
3. `allowAutonomousCommunication = false` AND `humanApproved = false` → **BLOCK**
4. Otherwise → **ALLOW**

## humanApproved flag semantics
- `humanApproved: true` — skips checks 2 & 3 above; only emergency pause can block. Use for:
  - `/api/agentmail/send` (manual send by COACH/ADMIN)
  - `/api/agentmail/reply` (manual reply by COACH/ADMIN)
  - `/api/agentmail/test` (test send by COACH/ADMIN)
  - `agentmail-reply-routes.ts` send-approved-reply endpoint (human clicked "Approve & Send")
- `humanApproved` omitted / `false` — full policy stack applies. Use for:
  - `agentmail-followup-service.ts` automated sequences
  - `opportunity-outreach-execution-agent.ts` autonomous outreach

## Files changed
- `server/services/agentmail-send-guard.ts` — created (guard + blocked-send logger)
- `server/services/agentmail-service.ts` — guard wired into both send functions; new params: `humanApproved`, `actionQueueId`, `gmailThreadId`; successful sends write to outbound_email_audit_log
- `server/agentmail-routes.ts` — 3 human callers updated with `humanApproved: true`
- `server/agentmail-reply-routes.ts` — 2 approval-flow callers updated with `humanApproved: true`
- `server/services/outbound-audit-log.ts` — 4 new traceability fields: `actionQueueId`, `gmailThreadId`, `sourceConversationId`, `agentMailMessageId`; `ensureTraceabilityColumns()` adds them via ALTER TABLE IF NOT EXISTS on first write
- `server/services/hermes-service.ts` — rewritten; every event writes to `agent_operating_timeline` even when Obsidian is down
- `server/routes.ts` — `makeIntegrations()` now async, checks real env vars (SENDGRID_API_KEY, STRIPE_SECRET_KEY, GOOGLE_CLIENT_SECRET, AGENTMAIL_API_KEY, etc.) and queries `outbound_email_audit_log` for real send counts/error rates; `system-health` endpoint now queries live DB (governance settings, heartbeat runs, pending approvals, failed workflows, audit log)
- DB: `autonomous_action_queue` gained 4 columns: `gmail_thread_id`, `source_conversation_id`, `source_action_id`, `source_system`

**Why:** The guard was missing entirely — any agent could send emails autonomously even when `neverAutoSend=true` or `emergencyPauseEnabled=true`. Integration status and system health were returning hardcoded fake data.
