---
name: Communication Safety Remediation
description: 9-phase remediation for critical risks found in 10-phase architecture audit — Gmail auto-send, race conditions, policy fail-open, missing Send Guard on cron paths, no unified audit log.
---

## What was done

Fixed 5 critical/high risks across 9 phases — remediation only, no new features.

### Phase 1 — Gmail Auto-Send Disabled
- `impl_gmail_send_email` in `server/agent-tools/implementations.ts` now calls `gmailCreateDraft` instead of `gmailSendEmail`
- Writes a `draft_created` record to the audit log
- Returns `blockedDirectSend: true` in result so callers know a draft was created

### Phase 2 — Race Condition / Duplicate Send Fix
- Both `processFollowUpsForOrg` (follow-up-cron.ts) and `executeFollowUp` (auto-execution-engine.ts) now do an atomic SQL claim:
  `UPDATE follow_ups SET status='processing' WHERE id=$1 AND status='pending' RETURNING id`
- If 0 rows returned → another worker claimed it first → skip

### Phase 3 — Policy Error Fail-Closed
- All `.catch()` blocks on `evaluatePolicy()` now return `approval_required` (not `auto_execute`)
- Changed in: follow-up-cron.ts, auto-execution-engine.ts, scheduled-email-agent.ts

### Phase 4 — Send Guard on All Cron Paths
- New service: `server/services/guarded-outbound-email.ts`
  - `guardedSendTeamTrainingOutreachEmail()` — wraps SendGrid send with 4-step guard: emergency pause → suppression → daily cap → cross-channel 24h
  - `guardedSendAgentOutreachEmail()` — for client re-engagement sends
- All 3 cron files replaced bare `sendTeamTrainingOutreachEmail()` calls with the guarded version

### Phase 5 — Policy Engine in Scheduled Email Agent
- `evaluatePolicy()` added to `scheduled-email-agent.ts` before each auto-send
- `blocked` → mark draft unapproved, log POLICY_BLOCKED
- `approval_required` → create `gmail_agent_actions` proposal, mark draft unapproved, skip

### Phase 6 — Unified Email Audit Log
- New service: `server/services/outbound-audit-log.ts`
  - `outbound_email_audit_log` table created lazily via SQL (no schema.ts change needed)
  - `writeOutboundAuditLog()` — never throws, best-effort
  - `queryOutboundAuditLog()` — filtered, paginated query helper
- New routes: `server/email-audit-routes.ts` — registered in `server/index.ts` after `registerEmailNotificationRoutes`
  - GET /api/email-audit — paginated log
  - GET /api/email-audit/stats — summary stats
  - GET /api/email-audit/blocked — blocked sends
- New UI page: `client/src/pages/admin-email-audit.tsx` at `/admin/email-audit`

### Phase 7 — Cross-Channel Coordination
- New service: `server/services/communication-coordination-service.ts`
  - `shouldSuppressCrossChannelSend()` — checks outbound_email_audit_log for recent sends within 24h window
  - `getRecentOutboundForRecipient()` — query helper
  - `recordOutboundTouch()` — no-op (audit log is source of truth)
  - `getLastTouchSummary()` — for approval UI display

### Phase 8 — UI Safety Warnings
- `admin-agentmail.tsx` — blue safety banner about approval-first + guard chain
- `admin-gmail-conversations.tsx` — purple draft-only notice
- `email-trigger-audit.tsx` — green safety remediation active notice
- `admin-email-audit.tsx` — amber safety active banner (on the audit page itself)

## Key rules going forward
- **Why:** Gmail agent could send emails with no guards, no daily cap, no emergency pause, no suppression check. Policy errors defaulted to auto_execute (fail-open). Follow-up cron and auto-exec engine could both process the same row.
- **How to apply:** Any new automated send path MUST use `guardedSendTeamTrainingOutreachEmail`. Any new policy evaluation MUST have a `.catch` that returns `approval_required`. Any new follow-up processing MUST do the atomic SQL claim first.
- Transactional emails (booking confirmations, reminders, password resets) are EXEMPT from the Send Guard chain — they have their own inline guards inside `sendEmail()`.
