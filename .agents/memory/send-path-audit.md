---
name: Send-Path Audit
description: Safety fixes and test coverage across all 5 email send paths, with key lessons about DB schema quirks.
---

## What was audited
5 send paths, each verified against 7 safety properties (suppression, emergency pause, first-contact gate, daily cap, outcome row, log event, double-send guard):
- **P1** Follow-Up Cron (`processFollowUpsForOrg`)
- **P2** Auto-Execution Engine (`executeFollowUp`)
- **P3** Gmail Approval (single + bulk, routes.ts)
- **P4** Team-Training Send + Old Outreach Send (routes.ts)
- **P5** Workflow Orchestrator (step idempotency)

## Shared guard service
`server/services/send-guard-service.ts` — exports `checkHumanApprovedSendGuards(orgId, email)` and `checkEmergencyPause(orgId)`. Human-approved paths use this; automated paths use `evaluatePolicy()`.

## Key schema/DB quirks discovered in tests

### Tables with Drizzle-only defaultFn for id (raw SQL won't get UUID auto)
- `org_ai_governance_settings` — `id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID())`
- `org_automation_settings` — same pattern
- Raw SQL inserts must include `gen_random_uuid()::text` explicitly for the id column.

**How to apply:** Any test helper using raw SQL `INSERT` into these tables must supply the id column explicitly: `(id, org_id, ...) VALUES (gen_random_uuid()::text, ${orgId}, ...)`.

### workflow_runs display_name NOT NULL in live DB
The `displayName` column in `workflow_runs` is `varchar("display_name")` (nullable) in the Drizzle schema, but the actual PostgreSQL table has a NOT NULL constraint. Always provide `displayName` when calling `storage.createWorkflowRun()`.

## Dead-letter service signatures
- `pushToDeadLetter({ orgId, jobName, error, payload?, maxRetries? })` — NOT `jobType`, NOT `errorMessage`
- `getDeadLetterJobs({ orgId?, status?, limit? })` — takes an opts object, NOT a plain string
- `markJobResolved(jobId)` — single string argument only

## Test file
`server/tests/send-path-audit.test.ts` — 48 tests across 8 describe blocks (SG, PL, P1–P5, CROSS). All 48 pass alongside prior 24/24 governance tests.

**Why:** Durable reference for anyone extending or re-running the audit.
