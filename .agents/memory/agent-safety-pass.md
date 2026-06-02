---
name: Agent Safety Pass
description: Key decisions and gotchas from the 5-priority agent system safety audit implementation.
---

## Rules implemented

**P1 — Follow-Up Cron Policy Gate**
- `server/email-agent/follow-up-cron.ts` fully rewrites `processFollowUpsForOrg`
- Body is generated BEFORE `evaluatePolicy()` so sensitive-language scan can run on actual content
- `blocked` → status="skipped", trigger log POLICY_BLOCKED
- `approval_required` → inserts `gmail_agent_actions` proposal (status="proposed", createdByAgent="follow_up_cron"), marks follow-up skipped
- `auto_execute` → inserts `gmail_agent_actions` (status="auto_executed") first, sends, then calls `createOutcomeOnSend()` with that ID
- `createOutcomeOnSend` signature: `{ orgId, gmailActionId, communicationDomain, messageType, recipientEmail, prospectId }`

**P2 — Auto-Execution Engine**
- `executeFollowUp()` in `auto-execution-engine.ts` now calls `evaluatePolicy()` before the `sendTeamTrainingOutreachEmail` call
- Policy non-auto_execute → inserts gmailAgentActions record, returns `null` (caller treats null as "not executed")
- After successful send → inserts gmailAgentActions (auto_executed) + fire-and-forget createOutcomeOnSend

**P3 — Execution Locks**
- `follow-up-cron.ts`: global `followUpCronIsRunning` flag (in-memory) + per-org `acquireJobLock(orgId, "follow_up_cron", 55)`
- `executive-agent.ts` (`startBusinessBrainCron`): per-org `acquireJobLock(orgId, "business_brain_cron", 55)` with try/finally releaseJobLock
- `scheduled-email-agent.ts` (`runDailyJobForAllOrgs`): global `dailyJobRunning` flag with try/finally guard
- Lock TTL is 55 minutes (shorter than 60-min interval) to prevent re-entry on server restart

**P4 — Dead-Letter Queue**
- `server/services/agent-dead-letter-service.ts` (new file)
- Table `agent_dead_letter_queue` created via `ensureTable()` / `executeSql` on module load (no migration needed)
- Exports: `pushToDeadLetter`, `getDeadLetterJobs`, `getDeadLetterSummary`, `markJobResolved`, `incrementRetryCount`
- Status lifecycle: pending → retrying → final_failed | resolved
- Retry schedule: 5 min initial, 15 min on subsequent increments

**P5 — TrainChat Safety**
- `server/services/trainchat-client.ts` uses `orgAiIntegrations` (provider="trainchat") NOT a separate table
- `ProgramResponseSchema` and `SessionResponseSchema` (Zod, `.passthrough()`) exported for test use
- `generateProgram` and `generateSession` validate response + fall back to OpenAI (gpt-4o-mini) if TrainChat unavailable
- Usage logged to `app_settings` key `trainchat_usage_{orgId}` (fire-and-forget)
- `encryptApiKey` / `decryptApiKey` / `maskApiKey` / `getConnectionStatus` all preserved unchanged

**Why:**
Follow-up emails were being sent directly to SendGrid with no autonomy policy check — the highest risk finding from the audit. Auto-execution engine had the same bypass. Duplicate cron runs could send double emails on server restart.
