# Runtime DDL inventory (focused reliability pass)

Captured on 2026-08-22 from production TypeScript under `server/`. Existing migrations are unchanged.

## Required startup group remediated

| Initializer | Tables | Invocation | Transaction / lock | Concurrent behavior | Failure behavior |
| --- | --- | --- | --- | --- | --- |
| `initializeRequiredSchema` | `system_logs`, `client_errors`, `query_failures`, `health_check_results`, `system_alerts`, `train_efficiency_schema_bootstrap` | First awaited database phase of `server/index.ts`, before seeds, route registration, jobs, and listen | One checked-out connection; `BEGIN`; deterministic two-key `pg_advisory_xact_lock`; all DDL, validation, and marker writes use that connection | Concurrent instances wait, then revalidate idempotent DDL | Rollback, state=`failed`, error rethrown, readiness blocked, server never listens |

The five reliability tables were previously created by `registerReliabilityRoutes` through
independent global Drizzle pool calls. Persistence helpers also invoked that lazy initializer.
`/healthz` returned 200 based only on `SELECT 1`. The DDL now has one startup owner and the
helpers require the completed bootstrap.

These operational tables have no declarations in `shared/schema.ts`. The compatibility check
and PostgreSQL tests compare every runtime column and required index in this touched raw-SQL
group against the actual PostgreSQL catalog.

## Deferred runtime DDL groups

The current-main scan found runtime DDL in 60 production modules besides the new bootstrap module. The main
groups below retain their existing behavior in this incremental pass.

| Group | Representative modules | Current timing / risk |
| --- | --- | --- |
| Attendance and scheduling | `attendance-routes.ts`, `attendance-report-cron.ts`, `scheduling-phase2-routes.ts`, `scheduling-intelligence-routes.ts` | Route registration plus request/cron repair; concurrency and swallowed-error review deferred |
| Agent execution and coordination | `services/unified-execution-engine.ts`, `cross-agent-coordination-service.ts`, `action-resolution-engine.ts`, `hermes-recommendation-engine.ts` | Mostly request/job-time `ensure*`; dependency ordering review deferred |
| Opportunity workflow | `opportunity-acquisition-routes.ts` and `services/opportunity-*.ts` | Request/job-time initialization across dependent modules; orchestration deferred |
| Operational agents | `agents/apex-agent.ts`, `agents/pulse-agent.ts`, `agent-dead-letter-service.ts`, `decision-journal-service.ts`, `software-kb-service.ts`, `obsidian-sync-service.ts` | Startup cron or lazy initialization; several best-effort DDL catches remain deferred |
| Book, communications, integrations | `book-funnel-routes.ts`, `email-notification-routes.ts`, `composio-*-routes.ts`, `services/outbound-audit-log.ts` | Route/request-time initialization; optionality must be classified before startup promotion |
| Large route-local groups | `routes.ts`, `partnership-routes.ts`, `sponsorship-routes.ts`, `workflow-job-queue.ts` | Mixed request/startup behavior; too broad for safe conversion in this pass |

AgentMail, payments, autonomy authorization, email-audit authorization, privilege escalation,
and webhook exploit work were excluded from investigation and changes as required.

The strongest deferred candidates are the attendance cron repair invoked at module load, the
dead-letter initializer whose module-load failure is swallowed, and Apex/Pulse index creation
that catches DDL errors. Their required/optional status and dependency order must be explicit
before they are moved into this boundary.
