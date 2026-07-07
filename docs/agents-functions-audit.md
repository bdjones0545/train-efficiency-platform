# Agents & Functions Audit — Live Automation Surface

**Document Type:** Audit
**Verification Status:** Verified Against Source
**Audit commit:** `f5873d6` (main, latest deployed — "Published your App")
**Scope:** `server/agents/*`, `server/email-agent/*`, `server/orchestration/*`,
`server/services/*` (agent/intelligence/cron), `server/frameworks/department-os/*`,
`server/agent-tools/*`, `server/workflows/*`, top-level `server/*agent*`,
`server/*intelligence*`, `server/*cron*`, `server/workflow-*`, plus the route surface
that mounts them.
**Constraints honored:** No source code changed. No refactors. No fixes. No
marketplace/org-authorization work. No server typecheck gate introduced. This is a
report-only PR.

> This audit is source-grounded: every claim below cites a file path (and, where
> useful, a line or function name) verified against the cloned repository at commit
> `f5873d6`. It complements — and does not replace — the existing
> [`docs/agent-catalog.md`](agent-catalog.md) and [`docs/core-services.md`](core-services.md),
> which describe intended architecture. Where this audit and those documents differ,
> this audit reflects what the code at `f5873d6` actually wires up.

---

## 1. Executive Summary

TrainEfficiency runs an unusually large in-process automation surface. The audit
identified **165 automation-surface modules** in scope (agents, orchestration
services, cron jobs, workflow/execution engines, AI/tool-calling functions), of which
roughly **40 are distinct "agent" systems** and the remainder are supporting services,
routers, and engines.

**Key structural findings:**

1. **All background automation starts in-process at server boot** via `setInterval` /
   `setTimeout` in [`server/index.ts`](../server/index.ts) and inside
   `registerRoutes()` in [`server/routes.ts`](../server/routes.ts). There is **no
   external job queue or scheduler**. At least **28 recurring/one-shot jobs** are armed
   on every process start (§4). Because they are per-process timers, a multi-instance
   deployment will double-run any job that is not DB-lock-guarded — CLAUDE.md and
   `docs/runbooks.md` already flag this; the CEO Heartbeat is the only job observed to
   take an explicit DB job lock (`acquireJobLock` in
   [`services/ceo-heartbeat-service.ts`](../server/services/ceo-heartbeat-service.ts)).

2. **The CEO Heartbeat is the single most load-bearing live component.** It is the
   most-imported service in the tree (14 importers), runs every 30 minutes for *all*
   orgs, and fans out to the Executive Agent, Daily Operations Engine, Hermes
   recommendation engine, and Software Improvement Agent
   ([`services/ceo-heartbeat-service.ts`](../server/services/ceo-heartbeat-service.ts)
   lines 557, 578, 654, 723). Any regression here degrades the whole "AI operating
   system" surface at once.

3. **The genuinely risky live write path is auto-send email**, gated only by
   `org.automationLevel`. At level ≥ 2 the campaign engine drafts/executes; at level ≥ 3
   `executeAutoActions()` actually sends without human approval
   ([`action-tracking.ts:1667`](../server/action-tracking.ts)). This runs every 30
   minutes for up to 100 orgs from `index.ts:219-235`. The layered send-guard chain
   (autonomy-policy-engine → send-guard-service → agentmail-send-guard →
   guarded-outbound-email) is the primary safety net and must be preserved by any new
   send path.

4. **Heavy functional duplication in the workflow/execution layer.** At least **six
   overlapping execution/orchestration engines** coexist (§7): `workflow-runner`,
   `workflow-job-runner`, `workflow-orchestrator`, `workflows/executor`,
   `services/unified-execution-engine`, and `services/agent-action-executor`. Several
   agent families (opportunity / hiring / partnership / sponsorship) are near-identical
   4–6 file copies of the same assessment→outreach→executive→learning pattern.

5. **Observability debt is systemic.** **646 error-swallowing sites across 100 files**
   (`catch {}`, `.catch(() => {})`, `.catch(() => ({...}))`). Many are intentional
   fail-closed guards, but the pattern is applied indiscriminately, so real failures in
   crons are invisible. **44 files self-provision database tables at runtime** via raw
   `CREATE TABLE IF NOT EXISTS` / `ensureTable()`, invisible to Drizzle migrations
   (matches `docs/schema.md` Appendix A).

6. **Only one file is confirmed fully dead:**
   [`services/outcome-bridge-service.ts`](../server/services/outcome-bridge-service.ts)
   (zero importers, not dynamically imported). The v1 agent adapters
   (`growth-agent`, `retention-agent`, `client-success-agent`, `scheduling-agent`) are
   *intentional* compatibility shims, not dead code, but are prime consolidation
   candidates.

**Overall risk posture:** The live surface works but is fragile — a large number of
un-lock-guarded per-process timers, one central orchestrator with no redundancy, an
auto-send path guarded only by policy code, near-zero unit-test coverage on agents, and
pervasive silent error handling. None of this requires an emergency fix, but it argues
strongly for hardening (locks, telemetry, smoke tests) before further expansion — which
is exactly the "harden before expanding" founder principle.

---

## 2. Method

- Cloned `bdjones0545/train-efficiency-platform` at `main` (`f5873d6`).
- Enumerated the in-scope file set (165 modules) and computed an **importer count** for
  each (how many non-test files reference it by path). Importer count = 0 → dead
  candidate; low counts feed the duplicate/consolidation analysis.
- Extracted the **live trigger graph** from the two boot files: every `setInterval` /
  `setTimeout` / `start*` / `initialize*` call in `server/index.ts` and inside
  `registerRoutes()` in `server/routes.ts`, plus every `register*Routes(app)` mount.
- Cross-checked auto-send gating, org-scoping, and the send-guard chain by reading the
  relevant functions (`action-tracking.executeAutoActions`, `ceo-heartbeat-service`,
  `agent-action-executor`).
- Counted cross-cutting quality signals (swallow sites, raw-SQL table creation, AI
  provider usage, tests).

Reachability caveat: a module imported only by `routes.ts` is *mounted* but may still be
referenced by only one dashboard endpoint; "mounted" here means "reachable from a
registered route or an armed cron," not "heavily used."

---

## 3. Live Agent Map (what actually runs)

### 3.1 Central orchestration

| Component | File | Trigger | Coordinates |
|---|---|---|---|
| **CEO Heartbeat** | `services/ceo-heartbeat-service.ts` | cron 30 min + 3 min after boot (`index.ts:594-596`) | Executive Agent, Daily Ops Engine, Hermes recommendation engine, Software Improvement Agent; DB job locks + idempotency + ledger drift check |
| **Executive Agent (Atlas / Business Brain)** | `agents/executive-agent.ts` | `startBusinessBrainCron()` (`routes.ts:15332`) + invoked by Heartbeat (`runOrchestrator`) | Aggregates department agents (growth/retention/client-success/scheduling) |
| **Admin-chat orchestrator (Atlas)** | `ceo-agent-orchestrator.ts` | API — `runCeoAgentOrchestration` (`routes.ts:42`) | Intent classification → routes to `agents/{client-success,growth,retention,scheduling}-agent.ts` |
| **Org Intelligence Orchestrator** | `orchestration/organization-intelligence-orchestrator.ts` | `initializeOrchestrator()` event-bus subscriptions (`index.ts:521-522`) | Event-driven cross-domain reactions |

### 3.2 Canonical agents (v2)

| Agent | File | Trigger | Identity |
|---|---|---|---|
| **Apex** (Growth/Revenue) | `agents/apex-agent.ts` | `startApexDailyCron()` (`index.ts:599-600`) | `growth_agent` |
| **Pulse** (Retention) | `agents/pulse-agent.ts` | `startPulseDailyCron()` (`index.ts:602-603`) | `retention_agent` |
| **Revenue Agent** | `revenue-agent.ts` | `startRevenueAgentCron()` (`routes.ts:15345`) | finance-adjacent |

### 3.3 Live scheduled jobs / crons (armed at boot)

See the full enumeration in **§4**. Highlights: outcome detection, auto-send &
campaigns, pending-action cleanup, recurring team-lead research, financial-event retry,
athlete-context refresh, intervention outcome-eval, daily-ops brief, daily revenue sync,
lead-recovery, agent-action executor, workflow runner + job runner, CEO Heartbeat, Apex,
Pulse, attendance report, Gmail sync, Obsidian sync, session/weekly reminders,
intelligence cron, lead-capture sequences, follow-up cron, scheduled email agent,
AgentMail follow-up interval, org-AI-infra backfill.

### 3.4 Live email/agent intelligence (all wired via `routes.ts:15335-15341`)

`email-agent/scheduled-email-agent.ts` (`initializeScheduledEmailAgent`),
`email-agent/follow-up-cron.ts` (`initializeFollowUpCron`),
`lead-capture-sequences.ts` (`initializeLeadCaptureSequenceCron`), and the supporting
`email-agent/*` intelligence modules (reply-classifier, conversation-stage,
contextual-intelligence, contact-quality, global-priority-engine, revenue-outcome-engine,
trigger-alerts, trigger-logger, audit-engine, auto-execution-engine).

### 3.5 Mounted route surface (62 route modules)

62 `register*Routes(app)` modules are mounted from `routes.ts`/`index.ts`. The
agent/automation-relevant ones: `agentmail-routes`, `agentmail-reply-routes`,
`agentmail-followup-routes`, `apex-agent-routes`, `pulse-agent-routes`,
`agent-quality-routes`, `agent-outcome-attribution-routes`, `autonomy-trust-routes`,
`ceo-heartbeat-routes`, `orchestration-routes`, `execution-routes`, `hermes-routes`,
`intelligence-routes`, `communication-intelligence-routes`, `outcome-intelligence-routes`,
`scheduling-intelligence-routes`, `athlete-intelligence-routes`, `pr-intelligence-routes`,
`department-command-center-routes`, `department-factory-routes`, `domain-outreach-routes`,
`opportunity-acquisition-routes`, `hiring-routes`, `partnership-routes`,
`sponsorship-routes`, `software-improvement-routes`, `obsidian-routes`, `forecast-routes`,
`composio-routes`, `composio-gmail-draft-routes`, `composio-slack-alert-routes`,
`composio-calendar-routes`, `coach-command-center-routes`, `coach-outreach-engine-routes`,
`adaptive-workflow-routes`, `reliability-routes`.

---

## 4. Live Scheduled Jobs / Crons — Full Inventory

All are armed in-process at boot. "Guard" = whether a DB lock prevents duplicate
execution across instances.

| # | Job | Entry point | Interval | Writes | Org-scoped | Guard |
|---|---|---|---|---|---|---|
| 1 | Outcome detection | `action-tracking.detectOutcomesForOrg` (`index.ts:210`) | 30 min | bookings/outcomes | yes (per-org loop) | none |
| 2 | Auto-send & campaigns | `action-tracking.runCampaignEngine` / `executeAutoActions` (`index.ts:219`) | 30 min | **sends email**, actions, outreach events | yes (per-org loop, `automationLevel` gate) | none |
| 3 | Pending-action cleanup | `storage.markExpiredAgentPendingActions` (`index.ts:239`) | 15 min + boot | agent_pending_actions | global | none |
| 4 | Recurring team-lead research | `team-training-prospecting` (`index.ts:252`) | 60 min + 2 min | team_training_prospects, outreach events, discovery attempts | yes (per-org, needs OPENAI_API_KEY) | none |
| 5 | Financial-event retry | `financial-event-retry-cron.runFinancialEventRetry` (`index.ts:471`) | 15 min | financial_event_failures | global | none |
| 6 | Athlete-context refresh | `services/athlete-context-broker.runDailyAthleteContextRefreshCron` (`index.ts:484`) | 24 h + 5 min | athlete context objects | global scan | none |
| 7 | Intervention outcome-eval | `services/intervention-learning-engine.runOutcomeEvaluationCron` (`index.ts:498`) | 6 h | intervention outcomes | yes (per-org loop, 50) | none |
| 8 | Org intelligence orchestrator | `orchestration/organization-intelligence-orchestrator.initializeOrchestrator` (`index.ts:521`) | event-bus | varies | event-scoped | n/a |
| 9 | Daily operations brief | `services/daily-operations-engine.runDailyOperationsCron` (`index.ts:526`) | 6 h + 8 min | daily briefs / recommendations | per-org | none |
| 10 | Daily revenue sync | `attention-engine.syncAttentionItems` (`index.ts:543`) | 24 h + 60 s | attention_items | per-org (50) | dedup via sourceId |
| 11 | Lead-recovery cron | `services/lead-recovery-cron.startLeadRecoveryCron` (`index.ts:572`) | 15 min | follow-up drafts (never auto-sends) | per-org | (verify) |
| 12 | Agent-action executor | `services/agent-action-executor.startActionExecutor` (`index.ts:578`) | 5 min | Gmail actions (policy-gated) | per-org | (verify) |
| 13 | Workflow runner | `workflow-runner.startWorkflowRunner` (`index.ts:585`) | interval | workflow runs | per-run | (verify) |
| 14 | Workflow job runner | `workflow-job-runner.startWorkflowJobRunner` (`index.ts:588`) | poll + stuck-check | workflow_jobs | per-job | atomic claim |
| 15 | **CEO Heartbeat** | `services/ceo-heartbeat-service.startCeoHeartbeat` (`index.ts:594`) | 30 min + 3 min | ceo_heartbeat_runs, timeline, recommendations | per-org | **acquireJobLock** |
| 16 | Apex daily | `agents/apex-agent.startApexDailyCron` (`index.ts:599`) | daily | apex_recommendations (raw SQL) | per-org | none |
| 17 | Pulse daily | `agents/pulse-agent.startPulseDailyCron` (`index.ts:602`) | daily | pulse_recommendations (raw SQL) | per-org | none |
| 18 | Org-AI-infra backfill | `services/org-ai-infrastructure.backfillAllOrgsAiInfrastructure` (`index.ts:610`) | boot one-shot (+30 s) | ai infra rows (idempotent) | all orgs | idempotent |
| 19 | Attendance report cron | `attendance-report-cron.startAttendanceReportCron` (`index.ts:637`) | interval | attendance reports | per-org | (verify) |
| 20 | Gmail sync cron | `services/gmail-sync-state.startGmailSyncCron` (`index.ts:641`) | hourly | gmail sync state | per-org token | (verify) |
| 21 | Obsidian sync cron | `services/obsidian-sync-service.startObsidianSyncCron` (`index.ts:644`) | interval | obsidian notes | per-org | (verify) |
| 22 | Business Brain cron | `agents/executive-agent.startBusinessBrainCron` (`routes.ts:15332`) | interval | executive summaries | per-org | none |
| 23 | Revenue Agent cron | `revenue-agent.startRevenueAgentCron` (`routes.ts:15345`) | interval | revenue signals | per-org | none |
| 24 | Weekly reminder | `weekly-reminder.startWeeklyReminderJob` (`routes.ts:15357`) | weekly | reminders (email/SMS) | per-org | none |
| 25 | Session reminder | `session-reminders.startSessionReminderJob` (`routes.ts:15358`) | interval | reminders (email/SMS) | per-booking | none |
| 26 | Intelligence cron | `intelligence-routes.startIntelligenceCron` (`routes.ts:15617`) | interval | intelligence rows | per-org | none |
| 27 | Lead-capture sequences | `lead-capture-sequences.initializeLeadCaptureSequenceCron` (`routes.ts:15341`) | 30 min | lead sequence sends | per-org | none |
| 28 | Follow-up cron | `email-agent/follow-up-cron.initializeFollowUpCron` (`routes.ts:15338`) | interval | follow-up sends (policy-gated) | per-org | atomic claim (per org-isolation test) |
| 29 | Scheduled email agent | `email-agent/scheduled-email-agent.initializeScheduledEmailAgent` (`routes.ts:15335`) | interval | email drafts/sends | per-org | (verify) |
| 30 | AgentMail follow-up | `agentmail-followup-routes` `setInterval(run, INTERVAL)` (`agentmail-followup-routes.ts:94`) | interval | agentmail follow-ups | per-org | (verify) |

> "(verify)" marks jobs whose duplicate-execution guard was not confirmed in this
> read-only pass — a recommended follow-up, not an assertion that they are unguarded.

---

## 5. Data-Writing Risk List (functions that write production data)

`storage.ts` alone exposes **361 async methods, ~142 of them writes** (create/update/
insert/delete/upsert/log/mark/record/save). The highest-risk *automated* writers:

| Path | Writes | Auto-send? | Org isolation | Cross-org risk |
|---|---|---|---|---|
| `action-tracking.executeAutoActions` (`action-tracking.ts:1667`) | outbound email + action rows | **Yes at automationLevel ≥ 3** | orgId param, per-org loop | Low if loop stays per-org; the send itself is the risk |
| `action-tracking.runCampaignEngine` (`action-tracking.ts:1552`) | drafts + level-3 sends | Yes at level ≥ 3 | orgId param | Low |
| `email-agent/follow-up-cron.processFollowUpsForOrg` | follow-up sends | policy-gated | atomic claim includes `org_id` (test-enforced) | Low |
| `services/agent-action-executor.runActionExecutorCycle` | Gmail actions | policy-gated, auto-exec on pass | per-org policy | Medium — executes real Gmail actions |
| `ceo-heartbeat-service.runHeartbeatCycle` | heartbeat runs, timeline, recs, ledger drift | no send | per-org, job-locked | Low |
| `team-training-prospecting` (recurring research, `index.ts:252`) | prospects, discovery attempts, outreach events | no send | orgId param | Low |
| `weekly-reminder` / `session-reminders` | reminder email/SMS | Yes (transactional) | per-org / per-booking | Low |
| `agents/apex-agent` / `agents/pulse-agent` | `apex_recommendations` / `pulse_recommendations` (raw SQL) | no send | per-org | Low, but tables outside Drizzle |

**Send-guard chain (must be preserved):** `autonomy-policy-engine` →
`send-guard-service` → `agentmail-send-guard` → `guarded-outbound-email`. Every
automated send evaluates policy and **fails closed** on error
(`evaluatePolicy().catch(() => ({ decision: "approval_required" }))`).

**Cross-org observations:** the automated writers all take an explicit `orgId` and loop
per-org, consistent with ADR-002. No confirmed cross-org write bug was found in this
pass. The residual risk is operational: per-process timers with no lock (§4) can
**double-execute** the same org's job on a multi-instance deploy, and the auto-send path
depends entirely on policy code rather than a hard human-approval gate.

---

## 6. Dead / Experimental / Unmounted

| File | Signal | Classification |
|---|---|---|
| `services/outcome-bridge-service.ts` | **0 importers**, not dynamically imported | **Dead — safe to delete after confirming no runtime string import** |
| `agents/growth-agent.ts` | self-described "v1 compatibility shim → delegates to Apex" | Duplicate/legacy (intentional; keep until callers migrate) |
| `agents/retention-agent.ts` | "v1 compatibility shim → delegates to Pulse" | Duplicate/legacy (intentional) |
| `agents/client-success-agent.ts`, `agents/scheduling-agent.ts` | imported only by `ceo-agent-orchestrator` | Live-but-legacy; consolidation candidates |
| `services/unified-execution-engine.ts` vs `workflows/executor.ts` vs `workflow-orchestrator.ts` | overlapping execution engines, low importer counts | Experimental/overlapping (see §7) |

No other in-scope file had zero importers. Everything else resolves to a mounted route
or an armed cron. **This is not the same as "actively used"** — many modules are reached
only by a single admin dashboard endpoint and may be effectively cold; those need
runtime telemetry (not static analysis) to confirm, which is why "add execution
telemetry" is a top-10 recommendation.

---

## 7. Duplicate / Overlapping Functions

### 7.1 Workflow / execution engines (6 overlapping)

| Engine | File | Entry | Role |
|---|---|---|---|
| Workflow runner | `workflow-runner.ts` | `runWorkflowCycle` / `startWorkflowRunner` | cron cycle over workflows |
| Workflow job runner | `workflow-job-runner.ts` | `executeWorkflowJob` / `startWorkflowJobRunner` | job-queue poller (atomic claim) |
| Workflow orchestrator | `workflow-orchestrator.ts` | `orchestrator` singleton + `WORKFLOW_TEMPLATES` | template-based orchestration (API `/api/workflows`) |
| Workflows executor | `workflows/executor.ts` | `startWorkflow` / `approveWorkflowStep` | another step-based engine |
| Unified execution engine | `services/unified-execution-engine.ts` | `executeAction` / `ensureExecutionTables` | generic action executor (API `/api/execution`) |
| Agent-action executor | `services/agent-action-executor.ts` | `runActionExecutorCycle` | Gmail policy executor cron |

These share responsibility for "run a queued/approved action." Strong candidate for a
consolidation design doc (do **not** refactor without it — CLAUDE.md ADR-005 favors
incremental evolution).

### 7.2 Department-agent families (near-identical copies)

Four B2B acquisition families implement the same
`assessment → outreach → executive → learning (+ department-coordinator)` pattern:

- **Opportunity**: `services/opportunity-{discovery,qualification,outreach,outreach-execution,followup,reply-intelligence,learning,executive,executive-coordinator}-agent.ts` + `opportunity-acquisition-orchestrator` + `opportunity-reply-monitor`
- **Hiring**: `services/hiring-{assessment,outreach,executive,learning}-agent.ts` + `hiring-department-coordinator`
- **Partnership**: `services/partnership-{assessment,outreach,executive,learning}-agent.ts` + `partnership-department-coordinator`
- **Sponsorship**: `services/sponsorship-{assessment,outreach,executive,learning}-agent.ts` + `sponsorship-department-coordinator`

Consolidation candidate: a single parameterized department-agent framework
(`frameworks/department-os` already exists and is mounted — these predate or bypass it).

### 7.3 v1→v2 agent adapters

`growth-agent`→`apex-agent`, `retention-agent`→`pulse-agent` (documented shims).
Overlapping "intelligence" services also cluster:
`revenue-intelligence` / `revenue-agent` / `financial-brain` / `revenue-recognition`;
`communication-intelligence-service` / `communication-coordination-service`;
`hermes-service` / `hermes-learning-service` / `hermes-recommendation-engine`.

---

## 8. Function-Quality Findings

| Issue | Evidence | Impact |
|---|---|---|
| **Silent error handling** | 646 swallow sites (`catch {}`, `.catch(() => {})`) across 100 files | Cron failures invisible; violates CLAUDE.md "avoid swallowing exceptions" |
| **Runtime schema creation** | 44 files with raw `CREATE TABLE IF NOT EXISTS` / `ensureTable()` | Tables outside Drizzle migrations; ordering-dependent (Apex/Pulse tables must exist before first Heartbeat) |
| **No duplicate-execution guard on most crons** | Only CEO Heartbeat + job-runner + follow-up-cron confirm locks; ~25 timers unguarded | Double-execution on multi-instance deploy |
| **Near-zero agent unit tests** | 26 test files, almost all authz/isolation (`phase1*`, `org-isolation`, `send-path-audit`, `tool-workflow-safety`); only `apex-agent.test.ts`/`pulse-agent.test.ts` cover agent logic | Regressions in 40 agents ship undetected |
| **Missing telemetry** | No per-agent execution counter/latency store observed beyond `unified-action-logger` (13 importers) | Cannot distinguish live-hot from cold-mounted modules |
| **Single-provider AI coupling** | 44 files import `openai`; 8 reference OpenRouter; 1 stray `anthropic` (the dev CLI dep) | Matches CLAUDE.md (OpenAI primary, Claude via OpenRouter only), but breadth of direct `openai` imports undercuts "AI behind a service" (ADR-008) |

---

## 9. Full Inventory Index

The complete importer-count table for all 165 modules is reproducible from the audit
script (`scratchpad/reach.sh`). Representative extract (importer count → module):

- **0** `services/outcome-bridge-service.ts` (dead)
- **1** `ceo-agent-orchestrator.ts`, `revenue-recognition.ts`, `recommendation-engine.ts`, `services/unified-execution-engine.ts`, `services/unified-action-queue.ts`, `workflow-runner.ts`, most `*-routes.ts` (mounted once), most department-agent files
- **2** `agents/{growth,retention,scheduling,client-success}-agent.ts`, `revenue-agent.ts`, `financial-brain.ts`, `attention-engine.ts`, `services/agent-action-executor.ts`, `workflow-job-runner.ts`
- **3** `agents/{apex,pulse,executive}-agent.ts`, `orchestration/organization-intelligence-orchestrator.ts`, `services/{daily-operations-engine,hermes-service,gmail-sync-state}.ts`
- **6–7** `services/{autonomy-policy-engine,notification-automation,outcome-intelligence-service,department-registry,composio-service}.ts`, `team-training-prospecting.ts`
- **13–14** `unified-action-logger.ts` (13), `services/ceo-heartbeat-service.ts` (14) — the backbone

---

## 10. Top 10 Recommended Fixes (ranked)

1. **Add DB job locks to every recurring cron** (mirror `acquireJobLock` from CEO
   Heartbeat) so a multi-instance deploy cannot double-send email or double-write
   recommendations. *(Highest risk × lowest effort.)*
2. **Add a hard, config-visible kill-switch + telemetry to the auto-send path**
   (`action-tracking.executeAutoActions`, level-3): count/log every automated send with
   orgId, and expose a global "pause all automated sends" flag independent of policy
   code.
3. **Delete `services/outcome-bridge-service.ts`** after a final runtime string-import
   grep — the only confirmed dead file.
4. **Add per-agent execution telemetry** (runs, last-run, errors, latency) via
   `unified-action-logger`, so "mounted but cold" modules can be distinguished from live
   ones and the next audit is data-driven, not static.
5. **Replace blanket `catch(() => {})` in crons with logged failures** (keep fail-closed
   semantics, but emit a structured error/metric). Start with the 30 boot jobs in §4.
6. **Write a consolidation design doc for the 6 workflow/execution engines** (§7.1)
   before any code change — pick one canonical engine, mark the others deprecated.
7. **Smoke-test the top 5 live agents** (CEO Heartbeat cycle, Apex, Pulse, auto-send
   campaign engine, follow-up cron) — a boot-time "can this run for a fixture org
   without throwing" test. Extends the existing `apex-agent.test.ts` pattern.
8. **Catalog the 44 raw-SQL `CREATE TABLE` sites** and fold them into the Drizzle schema
   (or document them formally in `docs/schema.md` Appendix A with ownership + startup
   ordering).
9. **Parameterize the 4 department-agent families** (opportunity/hiring/partnership/
   sponsorship, §7.2) onto the existing `frameworks/department-os` — largest dead-weight
   reduction opportunity.
10. **Reduce direct `openai` imports (44 files)** behind `ai-model-runtime.ts` /
    `integration-runtime.ts` so provider/model changes and rate-limit handling are
    centralized (ADR-008).

---

## 11. Recommended Next PR Batches (after this audit)

**Batch 1 — Automation safety (small, reversible, high value):**
- Add DB job lock helper + apply to the 3–5 highest-risk unguarded crons (auto-send,
  campaign engine, Apex, Pulse, weekly/session reminders).
- Add a global `AUTOMATION_SENDS_ENABLED` kill-switch checked inside the send-guard
  chain.
- Delete `outcome-bridge-service.ts`.
- *Rationale:* directly de-risks the only path that touches customers (email) and the
  only structural hazard (double-execution). No behavior change when single-instance.

**Batch 2 — Observability:**
- Per-agent execution telemetry via `unified-action-logger`.
- Convert cron `catch(() => {})` to logged failures (fail-closed preserved).
- Boot-time smoke tests for the top 5 live agents.

**Batch 3 — Duplication (design-first, no rewrite yet):**
- Design doc consolidating the 6 workflow/execution engines.
- Design doc folding the 4 department-agent families onto `frameworks/department-os`.

**Batch 4 — Schema hygiene:**
- Catalog + document (or migrate) the 44 raw-SQL table-creation sites.

Batches 3–4 are design/documentation PRs first, per ADR-005 (incremental evolution) and
the "harden before expanding" principle — no large refactor without an approved plan.

---

## Appendix A — Typecheck Baseline

Captured at audit time with `tsc --noEmit` (`npm run check`) at commit `f5873d6`.
The compiler needs `--max-old-space-size=8192` to finish (it OOM-aborts at the default
heap on this codebase — itself a signal of the tree's size).

- **Total errors: 374 — all in `server/`** (0 in `client/` or `shared/`).
- Top error codes: `TS2339` property-does-not-exist ×175, `TS2307` cannot-find-module
  ×65, `TS2345` arg-not-assignable ×33, `TS2353` ×20, `TS2322` ×16, `TS2769` ×15.
- Top files: `routes.ts` (101), `education-phase2-routes.ts` (25),
  `athlete-intelligence-routes.ts` (11), `workout-builder-routes.ts` (10),
  `workflows/executor.ts` (10), `guardian-routes.ts` (10),
  `services/guarded-outbound-email.ts` (8), `scheduling-assistant.ts` (8),
  `workflow-orchestrator.ts` (7), `services/software-improvement-agent.ts` (6),
  `storage.ts` (6).

**Why this matters for automation:** the build (`script/build.ts`, run by
`npm run build`) uses `tsx` and **does not typecheck the server**; `npm run check`
(`tsc`) is the only gate and is wired into neither the build nor CI. As a result,
type errors ship. Several are on **live automation paths audited above**, including
`email-agent/follow-up-cron.ts`, `email-agent/scheduled-email-agent.ts`,
`ceo-agent-orchestrator.ts`, `agents/pulse-agent.ts`, `agents/executive-agent.ts`,
`orchestration/organization-intelligence-orchestrator.ts`,
`services/guarded-outbound-email.ts` (part of the send-guard chain),
`services/software-improvement-agent.ts`, `workflows/executor.ts`, and
`workflow-orchestrator.ts`.

This audit does **not** propose fixing these (out of scope, and a server typecheck gate
was explicitly excluded). It records the number as the diagnostic baseline a later
hardening batch should drive down. The 65 `TS2307` "cannot find module" errors in
particular are worth an early look — some may indicate stale imports referencing moved
or deleted files.

_Note: `docs/error-audit.md` (referenced in prior session memory, ~496 ungated errors)
was not present on `main` at `f5873d6`; the 374 figure here is this audit's independent
measurement and may reflect intervening changes._
