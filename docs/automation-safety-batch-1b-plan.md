# Automation Safety Batch 1b — Encapsulated Cron Locks (Plan)

**Document Type:** Plan
**Verification Status:** Verified Against Source
**Planned against:** `main` @ `052dcc2` (an empty-diff Replit republish of `a306f0e`; identical source)
**Status:** Plan only — **no source changes, no lock implementation**. Awaiting approval.

> Follows Batch 1 (PR #19 kill-switch, PR #20 `index.ts` cron locks). Batch 1b covers
> the `start*Cron()` / `initialize*Cron()`-encapsulated agent/service crons whose
> interval lives *inside* an agent/service file, which PR-2 deliberately did not touch.
> Reuses the existing `acquireJobLock()` / `releaseJobLock()` helpers
> (`server/services/ceo-heartbeat-service.ts`, table `job_execution_locks`) and the
> `runWithJobLock` pattern established in `server/index.ts`.

---

## 1. Executive Summary

Eleven encapsulated crons were in scope. Investigation found:

- **2 are already fully locked** and must **not** be touched:
  - `startBusinessBrainCron` (`agents/executive-agent.ts:383`) — per-org `business_brain_cron` lock, 55m TTL, released in `finally`.
  - `initializeFollowUpCron` (`email-agent/follow-up-cron.ts:508`) — per-org `follow_up_cron` lock (55m) **plus** a per-row atomic `UPDATE … WHERE id=? AND org_id=? AND status='pending'` claim and an in-process `followUpCronIsRunning` guard.
- **9 remain unlocked** and are the subject of this plan:
  - **4 write-only** (no outbound messages) → **safe to lock immediately**: Apex, Pulse, Revenue Agent, Intelligence.
  - **5 sending** (email/SMS/agentmail) → **lock with caution**: Scheduled Email Agent, Lead-Capture Sequences, AgentMail Follow-up, Weekly Reminder, Session Reminder.

All duplicate-execution risk here is a **multi-instance** concern — `deploymentTarget = "autoscale"` can run multiple instances, and every one of these crons currently relies only on in-process guards (`initialized`, `jobStarted`, `followUpCronIsRunning`) or soft DB-timestamp checks (`hoursSinceRun >= 20`, `nextCheckAt`) that do **not** hold across processes.

The single highest-risk item is **`initializeScheduledEmailAgent`**: it fires on an `isTimeToRun()` wall-clock gate checked every 60s, so *every* instance triggers `runDailyJobForAllOrgs()` at ~08:30 simultaneously → duplicate outreach sends. It routes through `guardedSend*` so PR-1's kill-switch can stop it globally, but nothing currently prevents the duplicate.

Recommended shape: **three sequenced PRs** (write-only → reminders → outreach sends), smallest/safest first, each reusing the proven per-org / `__global__` lock pattern.

---

## 2. Cron Inventory Table

| # | Cron (fn) | File:line | Interval / trigger | Global vs per-org | Sends? | Existing safety | Rec. lock name | Rec. scope | Rec. TTL | Lock safe now? |
|---|---|---|---|---|---|---|---|---|---|---|
| 1 | `startApexDailyCron` | `agents/apex-agent.ts:528` (loop `:510`) | 24h; +2m after boot | per-org (loops all orgs in `runApexForAllOrgs`) | **No** — writes `apex_recommendations` (raw SQL) | in-process `_apexTimer` only | `apex_daily_cron` | `org.id` | 1440m | ✅ Safe now |
| 2 | `startPulseDailyCron` | `agents/pulse-agent.ts:725` (loop `:707`) | 24h; +3m after boot | per-org (`runPulseForAllOrgs`) | **No** — writes `pulse_recommendations` | in-process `_pulseTimer` only | `pulse_daily_cron` | `org.id` | 1440m | ✅ Safe now |
| 3 | `startRevenueAgentCron` | `revenue-agent.ts:327` | hourly tick; runs at org `dailyRunHour` | per-org (`getOrgIds()` loop) | **No** — writes revenue signals | `dailyRunEnabled`, `runHour`, soft `hoursSinceRun>=20` | `revenue_agent_cron` | `org.id` | 60m | ✅ Safe now |
| 4 | `startIntelligenceCron` (`runDueCycles`) | `intelligence-routes.ts:303` | 30m; +10s after boot | sweep of ≤20 due `athleteWatchlists` (not orgs) | **No** — writes monitoring data | soft `nextCheckAt` scheduling | `intelligence_monitoring_cron` | `__global__` (per-sweep) — *or* per-watchlist `w.id` (see §7) | 30m | ✅ Safe now |
| 5 | `initializeScheduledEmailAgent` (`runDailyJobForAllOrgs`) | `email-agent/scheduled-email-agent.ts:535` (loop `:508`) | daily ~08:30 via `isTimeToRun()`, checked every 60s | per-org (loops orgs) | **Yes** → `guardedSendTeamTrainingOutreachEmail` (kill-switch + send-guard covered) | in-process `initialized` only | `scheduled_email_agent` | `org.id` | 1440m | ⚠️ Caution |
| 6 | `initializeLeadCaptureSequenceCron` (`runLeadCaptureSequenceCron`) | `lead-capture-sequences.ts:355` | 30m; +5m after boot | per-org (`orgId` present) | **Yes** → `sendSubmissionFollowUp` / `sendAbandonedRecovery` | none observed at cron level | `lead_capture_sequences` | `org.id` | 30m | ⚠️ Caution (confirm loop) |
| 7 | AgentMail follow-up (`startFollowupCron` → `processDueFollowups`) | `agentmail-followup-routes.ts:94` | 20m; +30s after boot | per-org (`orgId` present); may be per-mailbox | **Yes** → `sendApprovedFollowup` (approval-gated) | approval gate on sends | `agentmail_followup` | `org.id` (confirm vs mailbox/account) | 20m | ⚠️ Caution (confirm scope) |
| 8 | `startWeeklyReminderJob` (`sendWeeklyReminders`) | `weekly-reminder.ts:54` | 7d; +60s after boot | **global** sweep of inactive users | **Yes** → `sendWeeklyReminderEmail` (`./email`, transactional path — **not** kill-switch covered) | none observed at cron level | `weekly_reminder` | `__global__` | 120m | ⚠️ Caution |
| 9 | `startSessionReminderJob` (`sendSessionReminders`) | `session-reminders.ts:237` | hourly; +startup delay | **global** sweep of upcoming sessions | **Yes** → `sendSms` + `sendUpcomingSessionReminderEmailToCoach` | in-process `jobStarted` only | `session_reminders` | `__global__` | 60m | ⚠️ Caution |
| — | `startBusinessBrainCron` | `agents/executive-agent.ts:383` | hourly | per-org | writes briefs (via `runOrchestrator`) | **ALREADY LOCKED** — `business_brain_cron`, 55m, `org.id`, `finally` | — | — | — | 🔒 Already done — do not touch |
| — | `initializeFollowUpCron` | `email-agent/follow-up-cron.ts:508` | hourly | per-org | **Yes** (guardedSend) | **ALREADY LOCKED** — `follow_up_cron` 55m + atomic row claim + in-process guard | — | — | — | 🔒 Already done — do not touch |

TTL rationale: TTL ≥ the cron interval so lock buckets align to ticks (same as PR-2). For the low-frequency global sweeps (weekly), TTL is set to a few multiples of the run duration (not the 7-day interval) so a crashed lock self-heals well before the next run.

---

## 3. Send-Risk Ranking (harm if a tick double-fires = duplicate outbound message)

1. **`initializeScheduledEmailAgent`** — automated outreach via `guardedSend*`. Highest volume/impact; kill-switch can stop it globally but not de-dupe.
2. **`initializeLeadCaptureSequenceCron`** — automated lead nurture (submission follow-up, abandoned recovery). Prospect-facing.
3. **AgentMail follow-up** — approved follow-up sends (approval gate limits blast radius, but a dup still double-sends an approved message).
4. **`startWeeklyReminderJob`** — re-engagement email to inactive users (transactional path; not kill-switch covered).
5. **`startSessionReminderJob`** — session reminder email **+ SMS** (SMS dups are especially user-visible / cost-bearing).
6. **Write-only (no send):** Apex, Pulse, Revenue Agent, Intelligence — a dup writes duplicate recommendations/rows, not messages.

---

## 4. Duplicate-Execution Risk Ranking (likelihood × harm on multi-instance)

1. **`initializeScheduledEmailAgent`** — `isTimeToRun()` wall-clock gate = all instances fire the same minute → **near-certain concurrent dup** + real sends. **Top priority.**
2. **AgentMail follow-up** — 20m interval, no cross-process guard, sends.
3. **`initializeLeadCaptureSequenceCron`** — 30m, no guard, sends.
4. **`startSessionReminderJob`** — hourly, only in-process `jobStarted`, sends email+SMS.
5. **`startWeeklyReminderJob`** — weekly, no guard, sends (low frequency lowers likelihood).
6. **`startRevenueAgentCron`** — hourly, soft `hoursSinceRun>=20` narrows the window but a two-instance read-before-write race still double-runs; write-only.
7. **Apex / Pulse** — daily, write-only; harm limited to duplicate recommendations (confirm raw-SQL upsert idempotency, §7).
8. **`startIntelligenceCron`** — soft `nextCheckAt` de-dup already narrows this; write-only.

---

## 5. Crons Safe to Lock Immediately (write-only, no send-timing change)

- `startApexDailyCron` — per-org `apex_daily_cron`, TTL 1440m, wrap the `for (const org of orgs)` body in `runApexForAllOrgs` (`apex-agent.ts:510`).
- `startPulseDailyCron` — per-org `pulse_daily_cron`, TTL 1440m, wrap `pulse-agent.ts:707` loop body.
- `startRevenueAgentCron` — per-org `revenue_agent_cron`, TTL 60m, wrap the per-org body in the `tick` loop (`revenue-agent.ts`).
- `startIntelligenceCron` — `__global__` `intelligence_monitoring_cron`, TTL 30m, wrap the `runDueCycles` sweep body.

These change **no** send behavior and mirror the already-shipped `business_brain_cron` pattern, so they are the lowest-risk first PR.

---

## 6. Crons Requiring Caution (they send — lock must not alter send semantics)

- `initializeScheduledEmailAgent`, `initializeLeadCaptureSequenceCron`, AgentMail follow-up — **automated outreach**. Locking only prevents a *duplicate* run; each already sends today. Verify the lock wraps the full per-org body so a partially-processed org isn't re-sent, and that `finally`-release cannot leave a mid-send org half-locked. Scheduled-email-agent is additionally covered by PR-1's kill-switch.
- `startWeeklyReminderJob`, `startSessionReminderJob` — **transactional reminders** (re-engagement, session email/SMS). Global locks. Must confirm these are *not* accidentally suppressed the way outreach is (they are intentionally exempt from the kill-switch; the lock is dedup-only). SMS dups in session-reminders carry cost — highest-care item among the reminders.

---

## 7. Open Questions / Needs-Investigation (resolve during implementation, not now)

1. **Apex/Pulse write idempotency** — confirm the raw-SQL `apex_recommendations` / `pulse_recommendations` writes upsert on a natural key. If idempotent, dup harm is already low; the lock is still worth it for cost/log-noise reasons.
2. **AgentMail follow-up scope** — confirm whether `processDueFollowups` iterates orgs or mailboxes/accounts. If per-mailbox, lock scope should be the mailbox/account id (`other`) rather than `org.id`.
3. **Lead-capture loop structure** — confirm `runLeadCaptureSequenceCron` loops per-org (so a per-org lock wraps cleanly) vs a single global sweep; adjust scope accordingly.
4. **Reminder per-recipient idempotency** — confirm whether `sendWeeklyReminders` / `sendSessionReminders` already de-dupe per user/session (e.g. a "last reminded" timestamp). Determines whether a duplicate send is currently *possible* (informational; the lock is safe regardless).
5. **Intelligence scope choice** — global per-sweep lock is simplest and sufficient (batch of ≤20). If watchlists grow, a per-watchlist (`w.id`) lock gives better parallelism; flagged as a later refinement, not needed now.

---

## 8. Proposed PR Breakdown (sequenced, smallest/safest first)

### PR 1b.1 — Lock write-only agent crons *(ship first)*
- **Title:** `feat(safety): DB job locks on write-only agent crons (apex/pulse/revenue/intelligence)`
- **Files to change:** `agents/apex-agent.ts`, `agents/pulse-agent.ts`, `revenue-agent.ts`, `intelligence-routes.ts`.
- **Change:** wrap each per-org loop body (Apex/Pulse/Revenue) or the global sweep (Intelligence) with `acquireJobLock`/`releaseJobLock` (skip+log on miss, release in `finally`) — mirroring `business_brain_cron`.
- **Behavior:** single-instance unchanged; multi-instance runs each unit once. No send paths touched.
- **Tests:** DB-free wiring test asserting each of the 4 crons references its lock name + a lock call; extend the key-logic contract from `cron-job-locks-wiring.test.ts`. DB-integration assertions reuse the existing `cron-job-locks.test.ts` harness.
- **Verify:** server tsc must stay at baseline (currently 374), client tsc 0, wiring tests green.
- **Rollback:** revert commit; locks self-expire. No schema change.
- **Non-goals:** no send crons, no agent logic changes, no idempotency refactors.

### PR 1b.2 — Lock transactional reminder sweeps
- **Title:** `feat(safety): global DB job locks on weekly/session reminder crons`
- **Files:** `weekly-reminder.ts`, `session-reminders.ts`.
- **Change:** `__global__` lock around each sweep (`weekly_reminder` TTL 120m; `session_reminders` TTL 60m).
- **Caution:** confirm (Q4) reminder idempotency; ensure lock is dedup-only and does not suppress legitimate reminders. SMS path gets extra care.
- **Tests/verify/rollback:** as 1b.1.
- **Non-goals:** no change to reminder content, cadence, or the kill-switch exemption.

### PR 1b.3 — Lock automated-outreach senders *(ship last, most care)*
- **Title:** `feat(safety): DB job locks on scheduled-email / lead-capture / agentmail-followup senders`
- **Files:** `email-agent/scheduled-email-agent.ts`, `lead-capture-sequences.ts`, `agentmail-followup-routes.ts`.
- **Change:** per-org lock wrapping the full per-org send body (`scheduled_email_agent` TTL 1440m; `lead_capture_sequences` TTL 30m; `agentmail_followup` TTL 20m — scope pending Q2).
- **Caution:** highest send-risk; verify no half-processed org can be re-sent, and that `guardedSend*` (scheduled-email) / approval gates (agentmail) remain in force. Resolve Q2/Q3 first.
- **Tests/verify/rollback:** as 1b.1, plus a re-run of `send-path-audit`/`tool-workflow-safety` against a test DB before merge.
- **Non-goals:** no change to send routing, approval gates, or the kill-switch.

**Dependencies:** none between PRs (disjoint files); sequence is by risk, not dependency. **Do not touch** `startBusinessBrainCron` or `initializeFollowUpCron` in any PR — already locked.

---

## 9. Constraints Honored
No source changed, no refactors, no agent behavior changes, no marketplace/org-authz work, no new migrations (reuses `job_execution_locks`), no TypeScript cleanup. Implementation deferred pending approval.
