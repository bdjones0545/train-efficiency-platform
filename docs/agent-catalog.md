---
Document Type: Implementation
Verification Status: Verified Against Source
Last Reviewed: 2026-06-28
Owner: Engineering
---

# Agent Catalog

Comprehensive catalog of every AI agent, orchestrator, and automated engine in the TrainEfficiency platform. All entries are derived directly from repository source files — function names, constants, table names, and integration points are copied exactly as they appear in code. No summaries or inferences.

---

## Document Status

This document covers the full agent layer as of 2026-06-28. Every agent entry includes its source file, exported functions, runtime schedule, database dependencies, safety gates, and wiring points. Agents that are **v1 compatibility adapters** (thin wrappers that delegate to a v2 implementation) are clearly marked.

---

## Purpose

The agent catalog serves as the authoritative reference for:

- What agents exist, what they are named, and where their source lives
- How each agent is invoked (cron, HTTP trigger, orchestrator call)
- What databases tables each agent owns or writes to
- Which safety gates (policy engine, send guard, job locks) are applied on each send path
- How agents are registered in the identity registry and what actor types they log under

---

## Responsibilities

- Document every agent identity registered in `server/agent-identities.ts`
- Document every cron-backed agent and its schedule
- Document the CEO Orchestrator's intent-classification and routing logic
- Document the Email Agent sub-system (all 12 files in `server/email-agent/`)
- Document safety layers that apply across the agent layer
- Identify tables owned or written by each agent (including raw-SQL tables not in Drizzle schema)

---

## Does NOT Own

- HTTP route registration (covered in `docs/core-services.md`)
- Database schema definitions (covered in `docs/schema.md`)
- Revenue attribution logic beyond the `ai_revenue_events` write path
- Frontend pages that display agent output

---

## Architecture

The agent layer has three tiers:

1. **Identity Registry** — `server/agent-identities.ts` defines 9 canonical agent identities. Every agent action logged to `unified_agent_action_log` uses an `actorType` that must match one of these identities.

2. **Orchestration Layer** — `server/ceo-agent-orchestrator.ts` classifies user intent with GPT-4o, routes to specialized agents, and streams a synthesized response via Server-Sent Events (SSE). Named `Atlas` in the UI.

3. **Execution Layer** — Individual agents (Apex, Pulse, Client Success, Scheduling) run on their own cron schedules and write recommendations or send emails. The Email Agent sub-system (`server/email-agent/`) handles all outbound prospecting email with a 12-file safety stack.

Every automated outbound send path passes through:
- **Autonomy Policy Engine** (`server/services/autonomy-policy-engine.ts`) — evaluates 11 policy checks; fail-closed (errors default to `approval_required`)
- **AgentMail Send Guard** (`server/services/agentmail-send-guard.ts`) — second-layer gate after policy approval
- **Dead-letter service** (`server/services/agent-dead-letter-service.ts`) — captures every failed agent action

---

## Agent Identity Registry

**Source:** `server/agent-identities.ts`

The registry defines 9 named agent identities. The exact object shape exported from this file is the authoritative list — no other agent identifiers are recognized by the logging layer.

| `agentId` | Display Name | Description (from source) |
|---|---|---|
| `executive_agent` | **Atlas** | Business intelligence orchestrator |
| `retention_agent` | **Pulse** | Client retention and engagement agent |
| `growth_agent` | **Apex** | Business growth and lead generation |
| `scheduling_agent` | **Tempo** | Scheduling and calendar management |
| `finance_agent` | **Ledger** | Financial tracking and analysis |
| `communication_agent` | **Relay** | Communication and outreach management |
| `research_agent` | **Vector** | Market research and intelligence |
| `workflow_agent` | **Nexus** | Workflow automation and optimization |
| `system_agent` | **Core** | System monitoring and maintenance |

**Important:** `retention_agent` (Pulse) and `growth_agent` (Apex) are v1 identity names. Their v2 implementations live in `server/agents/pulse-agent.ts` and `server/agents/apex-agent.ts` respectively. The v1 thin-adapter files (`server/agents/retention-agent.ts` and `server/agents/growth-agent.ts`) exist for backwards compatibility only.

---

## Components

### 1. CEO Orchestrator (Atlas)

**Source:** `server/ceo-agent-orchestrator.ts`

**What it does:** Receives a natural-language query from the admin chat interface, classifies the intent with GPT-4o, routes to one or more specialized agents, and streams a synthesized reply via SSE.

**Export shape:**
```
export function runOrchestrator(params): AsyncGenerator<string>
```
The export is a **non-async** function that returns an `AsyncGenerator` directly. This is intentional — making it `async` would break SSE streaming because it would await the generator before the caller can consume it. (`moduleResolution: bundler` in `tsconfig.json` means no `.js` extension is needed on imports.)

**Intent Classification:**
- Model: `gpt-4o`
- Input: user query + system context string
- Output: one of a fixed set of intent categories (e.g., `scheduling`, `revenue`, `retention`, `growth`, `general`)
- Classification is performed before any downstream agent call

**Synthesis:**
- Model: `gpt-5.1` (falls back to `gpt-4o` if unavailable)
- Streams token-by-token via SSE to the frontend chat component
- Synthesis prompt includes the raw output from all consulted sub-agents

**Decision Journal integration:**
- `RecordDecisionInput` fields: `agent`, `sourceType`, `source`, `decision` (not `madeBy`/`decisionText` — those are a different schema variant)
- Every orchestrator routing decision is written to `decision_journal_entries` via `server/services/decision-journal-service.ts`

**Does NOT:**
- Persist conversation history to database
- Manage session state across requests
- Have its own cron schedule

---

### 2. Executive Agent (Atlas Business Brain)

**Source:** `server/agents/executive-agent.ts`

**Exported functions:**
- `runOrchestrator(params)` — single-org orchestration pass (see CEO Orchestrator above; both live in this file and are re-exported)
- `startBusinessBrainCron()` — registers a recurring background job

**Cron schedule:** Defined inside `startBusinessBrainCron()`; runs periodic cross-system intelligence synthesis.

**Actor type logged:** `executive_agent` in `unified_agent_action_log`

**Primary purpose:** Synthesizes signals from all other agents into a unified business health picture. Sources include CEO Heartbeat runs, recommendation engine output, and Hermes learnings.

---

### 3. Apex Agent (Growth)

**Source:** `server/agents/apex-agent.ts`

**Exported functions:**
- `runApexForOrg(orgId: string): Promise<ApexResult>` — runs one growth analysis cycle for a single org
- `startApexDailyCron(): void` — registers a daily cron job

**Cron schedule:** Daily; started via `startApexDailyCron()` during server boot.

**Actor type logged:** `actorType = "growth_agent"` in `unified_agent_action_log`

**Auth import:** `replit_integrations/auth` (not `middleware/auth`) — this is a known gotcha. External route files for this agent define a local `requireAdmin` helper rather than importing `requireRole` from `routes.ts` (which is not exported).

**Database tables:**

| Table | Type | Owner |
|---|---|---|
| `apex_recommendations` | Raw SQL (not in Drizzle schema) | Apex Agent |
| `unified_agent_action_log` | Drizzle (shared) | Written by Apex |

`apex_recommendations` is self-provisioned on startup via `ensureApexRecommendationsTable()`. This function must complete before the first heartbeat cycle queries it, or the CEO Heartbeat Apex section will fail with a "relation does not exist" error.

**What it produces:**
- Growth recommendations written to `apex_recommendations`
- Action log entries in `unified_agent_action_log` with `actorType = "growth_agent"`
- Input to the Global Priority Engine for cross-agent action ranking

---

### 4. Pulse Agent (Retention)

**Source:** `server/agents/pulse-agent.ts`

**Exported functions:**
- `runPulseForOrg(orgId: string): Promise<PulseResult>` — runs one retention analysis cycle for a single org
- `startPulseDailyCron(): void` — registers a daily cron job

**Cron schedule:** Daily; started via `startPulseDailyCron()` during server boot.

**Database tables:**

| Table | Type | Owner |
|---|---|---|
| `pulse_recommendations` | Raw SQL (not in Drizzle schema) | Pulse Agent |
| `unified_agent_action_log` | Drizzle (shared) | Written by Pulse |

`pulse_recommendations` is self-provisioned on startup via `ensurePulseRecommendationsTable()`. Same risk as Apex: must exist before CEO Heartbeat queries it.

**What it produces:**
- Retention recommendations written to `pulse_recommendations`
- Action log entries in `unified_agent_action_log`
- At-risk client alerts surfaced on the CEO Heartbeat page

---

### 5. Retention Agent (v1 Adapter)

**Source:** `server/agents/retention-agent.ts`

**Status:** V1 compatibility adapter. **Delegates entirely to Pulse Agent.**

Contains no independent logic. Any caller still referencing the v1 `retention_agent` identity goes through this file and arrives at `runPulseForOrg()`.

---

### 6. Growth Agent (v1 Adapter)

**Source:** `server/agents/growth-agent.ts`

**Status:** V1 compatibility adapter. **Delegates entirely to Apex Agent.**

Contains no independent logic. Any caller still referencing the v1 `growth_agent` identity goes through this file and arrives at `runApexForOrg()`.

---

### 7. Client Success Agent

**Source:** `server/agents/client-success-agent.ts`

**Exported functions:**
- `runClientSuccessAgent(orgId: string): Promise<void>` — runs a full client success analysis pass

**Known bug (historical, patched):** Float arithmetic score expressions (`×0.3`, `×0.5`) were feeding directly into integer DB columns. Fix: all score and `priorityScore` expressions must be wrapped with `Math.round()`. Additionally, a ledger drift check used `u.organization_id` but the `users` table has no such column — the fix requires joining `user_profiles` via `ON up.user_id = u.id` and filtering on `up.organization_id`.

**Database tables written:**
- `ceo_heartbeat_runs` (indirectly, via heartbeat coordination)
- Writes client health scores to relevant client profile tables

---

### 8. Scheduling Agent

**Source:** `server/agents/scheduling-agent.ts`

**Exported functions:**
- `runSchedulingAgent(params): Promise<SchedulingAgentResult>` — executes AI-assisted scheduling actions

**Agent identity:** `scheduling_agent` (Tempo) in the identity registry

**OpenAI integration:** Uses function calling (tool use) to expose scheduling capabilities to the LLM. Tool names verified from `server/agents/scheduling-agent.ts`:
- `schedule_find_availability`
- `suggest_times`
- `detect_conflicts`
- `create` (session creation)
- `reschedule`
- `cancel`

**Duration constraint:** `durationMinutes` maximum is **480** (not 59 — this was a former validator bug). Verified in source.

---

## Email Agent Sub-system

**Source directory:** `server/email-agent/` (12 files)

This is a multi-file pipeline responsible for all AI-driven outbound prospecting email: draft generation, send scheduling, follow-up sequencing, reply classification, and revenue attribution. Every file is cataloged below.

---

### 8a. Scheduled Email Agent

**Source:** `server/email-agent/scheduled-email-agent.ts`

**Exported functions:**
- `runEmailAgentForOrg(orgId, triggerSource): Promise<DailyJobResult>` — runs a full outreach cycle for one org; `triggerSource` is `"cron_8_30am" | "user_click" | "api_call"`
- `initializeScheduledEmailAgent(): void` — starts the polling interval; idempotent (no-op on second call)

**Schedule:** Polls every 60 seconds; fires `runDailyJobForAllOrgs()` only when `isTimeToRun()` returns true (8:30 AM ± 4 minutes: `h === 8 && m >= 30 && m <= 34`). Per-org deduplication: if `settings._lastRunDate === today`, the org is skipped.

**DailyJobResult shape:**
```typescript
{
  orgId: string;
  draftsGenerated: number;
  emailsSent: number;
  emailsSkipped: number;
  emailsBlocked: number;
  emailsFailed: number;
  errors: string[];
}
```

**Daily limit:** `Math.min(settings.dailyLimit, 10)` — hard cap of 10 emails per org per day regardless of settings.

**Send path (in order):**
1. Check `settings.enabled` — skip org if false
2. Call `storage.buildDailyOutreachQueue(orgId, dailyLimit)` to fetch eligible prospects
3. For each prospect: check `contactEmail` present, check DNC status, check opt-out list
4. Collision detection via `detectTriggerCollision(orgId, prospectId, 5)` (5-minute window)
5. Draft generation via `generateOutreachEmailFromVariant()` or `generateOutreachEmail()` if no variant exists
6. **Autonomy Policy Gate:** `evaluatePolicy({ actionType: "send_initial_email", isFirstContact: true, isNewRecipient: true, confidence: 0.80, riskLevel: "low" })` — fail-closed: errors default to `approval_required`
7. If `approval_required`: insert row into `gmail_agent_actions` with `status: "proposed"`; skip send
8. If `blocked`: un-approve draft; skip send
9. If `auto_execute`: **Send Guard** via `guardedSendTeamTrainingOutreachEmail()`
10. On success: update `outreachDrafts.sentAt`, update prospect `outreachStatus = "Contacted"`, schedule follow-ups via `scheduleFollowUpsForDraft()`
11. Auto-optimize variants every 50 emails sent (`storage.runVariantOptimization(orgId)`)

**Conversation stage and contact quality injected into draft generation** (Phase 9): `computeContactQualityScore()` and `computeConversationStage()` are called before generation, and their outputs are passed into the generation prompt as `contactQualityScore` and `stageContext`.

**Trigger logging:** Every prospect evaluation is logged to `email_trigger_events` via `logTriggerEvent()` / `updateTriggerEvent()` with before/after execution state.

---

### 8b. Follow-Up Cron

**Source:** `server/email-agent/follow-up-cron.ts`

**Exported functions:**
- `scheduleFollowUpsForDraft(orgId, outreachDraftId, prospectId, sentAt?, engagementParams?): Promise<void>` — schedules the follow-up sequence for a freshly-sent draft
- `processFollowUpsForOrg(orgId): Promise<{ sent, skipped, errors }>` — processes all due follow-ups for one org
- `computeAdaptiveFollowUpDays(params): number[]` — pure function; returns adjusted schedule based on engagement signals
- `initializeFollowUpCron(): void` — starts the hourly cron; idempotent

**Schedule:** Runs immediately on boot (15-second delay) then every hour (`setInterval(..., 60 * 60 * 1000)`). Global in-flight guard: `followUpCronIsRunning` prevents overlapping ticks.

**Base schedule constants (from source):**
```typescript
const BASE_FOLLOW_UP_DAYS = [3, 7, 14];
const MAX_FOLLOW_UPS = 3;
```

**Adaptive schedule adjustments:**
- High engagement (clicked or opened ≥ 2): subtract 2 days from each interval (min 1 day)
- Zero opens: add 2 days (max `cooldownDays - 1`)
- Warmth ≥ 60 AND fit ≥ 60: subtract 1 additional day
- Risk ≥ 50: add 3 days

**Per-org locking:** `acquireJobLock(orgId, "follow_up_cron", 55)` — 55-minute lock prevents same org running twice within a tick window.

**Atomic row claim (race prevention):**
```sql
UPDATE email_follow_ups
SET status = 'processing'
WHERE id = $followUpId AND org_id = $orgId AND status = 'pending'
RETURNING id
```
If `claimedRows.length === 0`, the row was already claimed by a concurrent worker — skip silently.

**Follow-up send path (in order):**
1. Atomic claim (above)
2. Prospect exists and has `contactEmail`
3. Prospect `outreachStatus` is not `"Do Not Contact"` or `"Replied"`
4. No active deal (status not in `["won", "lost"]`)
5. Opt-out check
6. `stepNumber <= MAX_FOLLOW_UPS`
7. Generate subject/body if not pre-set (uses opener rotation and engagement-aware closing lines)
8. **Autonomy Policy Gate:** `evaluatePolicy({ actionType: "send_follow_up", confidence: 0.80, riskLevel: "low" })` — fail-closed
9. If `approval_required`: insert `gmail_agent_actions` row with `status: "proposed"`, `createdByAgent: "follow_up_cron"`, `actionType: "follow_up_email"`
10. If `auto_execute`: insert tracking record, call `guardedSendTeamTrainingOutreachEmail()`, call `createOutcomeOnSend()` (fire-and-forget)
11. On any exception: push to dead-letter queue, log system event, update follow-up status to `"skipped"`

---

### 8c. Auto-Execution Engine

**Source:** `server/email-agent/auto-execution-engine.ts`

**Purpose:** Picks the highest-priority auto-safe action from the Global Priority Engine queue and executes it autonomously, subject to all safety gates.

**Hard limits (from source):**
- Maximum **3 auto-executed actions per day** per org
- Only these action types are considered "auto-safe":
  - `"send_follow_up"`
  - `"generate_draft"`
  - `"send_initial_email"`
- All other action types require human approval

**Safety gate order:**
1. Check daily auto-execute count (≤ 3)
2. Autonomy Policy Gate (`evaluatePolicy()`)
3. AgentMail Send Guard (`guardedSendTeamTrainingOutreachEmail()`)

**Fail-closed:** Policy evaluation errors default to `approval_required` — never `auto_execute`.

---

### 8d. Global Priority Engine

**Source:** `server/email-agent/global-priority-engine.ts`

**Purpose:** Aggregates actions from all agent sources (Apex recommendations, Pulse recommendations, follow-up queue, Email Agent drafts) into a single ranked action queue. Cross-agent ranking prevents multiple agents from independently deciding the same action is top-priority.

**Output:** A sorted array of `PrioritizedAction` objects, each with:
- `source` (which agent produced it)
- `priority` (numeric score)
- `actionType`
- `orgId`
- `metadata`

Used by the Auto-Execution Engine as its input queue.

---

### 8e. Reply Classifier

**Source:** `server/email-agent/reply-classifier.ts`

**Purpose:** Classifies inbound prospect email replies into one of 7 categories.

**`ReplyClassification` type (from `contextual-intelligence.ts` which re-exports it):**
```typescript
type ReplyClassification =
  | "interested"
  | "not_interested"
  | "ask_info"
  | "referral"
  | "wrong_contact"
  | "out_of_office"
  | "unknown"
```

**Model:** OpenAI GPT-4o (or similar); the classification is stored on the `outreach_drafts.replyClassification` column after the reply is received.

**Downstream consumers:**
- `contextual-intelligence.ts` → `computeConversationStage()` uses the classification to advance the conversation stage
- `contextual-intelligence.ts` → `getNextBestAction()` uses it to determine the recommended next action
- CEO Heartbeat reply analysis block

---

### 8f. Audit Engine

**Source:** `server/email-agent/audit-engine.ts`

**Purpose:** Performs a health audit of the Email Agent sub-system, surfacing configuration gaps, missing integrations, and policy mismatches.

**Exported:** `runEmailAgentAudit(orgId): Promise<AuditResult>`

**Output used by:** The Email Trigger Audit page at `/admin/email-audit`.

**Audit checks include (not exhaustive):**
- SendGrid integration configured
- Email agent enabled for org
- Daily limit within safe range
- Policy engine reachable
- Active prospects with missing emails (missed opportunity detection)

---

### 8g. Trigger Logger

**Source:** `server/email-agent/trigger-logger.ts`

**Purpose:** Writes structured decision records to `email_trigger_events` for every prospect evaluation — both executions and skips. Provides the raw data for the Email Trigger Audit page.

**Exported functions:**
- `logTriggerEvent(params): Promise<string>` — creates the initial trigger record; returns `triggerEventId`
- `updateTriggerEvent(triggerEventId, update): Promise<void>` — updates with execution outcome
- `detectTriggerCollision(orgId, prospectId, windowMinutes): Promise<string | null>` — checks if a trigger was already fired for this prospect within `windowMinutes`; returns collision description or null
- `buildTriggerContextForProspect(orgId, prospectId): Promise<string>` — returns a human-readable string summarizing the prospect's prior trigger history; injected into draft generation reasoning

**Table written:** `email_trigger_events` (Drizzle schema; see `docs/schema.md`)

**Block reason codes written to `blockReason` column:**
- `"MISSING_EMAIL"` — no contact email
- `"DNC"` — Do Not Contact status
- `"OPTED_OUT"` — email on opt-out list
- `"POLICY_BLOCKED"` — Autonomy Policy Engine blocked
- `"COOLDOWN_ACTIVE"` — within cooldown window or max follow-ups reached
- `"DEAL_ACTIVE_BLOCK"` — active deal exists, cold follow-up suppressed
- `"DAILY_LIMIT_REACHED"` — daily send cap hit
- `"INVALID_STAGE"` — generation or send error

---

### 8h. Trigger Alerts

**Source:** `server/email-agent/trigger-alerts.ts`

**Purpose:** Generates proactive alert objects from `email_trigger_events` data. Alerts surface in the Email Trigger Audit page and the CEO Heartbeat dashboard.

Alert types include: high block rates, repeated DNC triggers, policy escalations, missed-opportunity streaks.

---

### 8i. Contextual Intelligence

**Source:** `server/email-agent/contextual-intelligence.ts`

**Purpose:** Builds a complete `ProspectContext` object for any prospect. This is the single source of intelligence for per-prospect decision-making.

**Exported functions:**
- `buildProspectContext(prospectId, orgId): Promise<ProspectContext | null>` — assembles engagement history, deal status, safety flags, intelligence scores, contact quality, and conversation stage in one call
- `getNextBestAction(params): NextBestAction` — pure function; returns the recommended next action given current context

**`ProspectContext` shape:**
```typescript
{
  prospect: any;
  engagement: {
    totalSent: number; opened: boolean; openCount: number;
    clicked: boolean; replied: boolean;
    replyClassification: ReplyClassification | null;
    replyText: string | null; lastDraftSentAt: Date | null;
  };
  outreachHistory: any[];
  followUps: any[];
  deal: any | null;
  safety: { isDNC: boolean; isOptedOut: boolean; cooldownActive: boolean; nextEligibleDate: Date | null };
  intelligence: { scores: IntelligenceScores; nextBestAction: NextBestAction };
  contactQuality: ContactQuality;
  conversationStage: ConversationStage;
  stageInfo: StageInfo;
}
```

**`IntelligenceScores` — all 0–100:**

| Score | Base | Key adjustments |
|---|---|---|
| `warmth` | 20 | +35 replied, +25 classified interested, +15 clicked, +15 opened ≥ 2, −35 not_interested/wrong_contact |
| `urgency` | 0 | +50 interested reply, +35 ask_info, +20 active deal, +20 deal stale ≥ 7 days |
| `fit` | 20 | +20 has email, +≤15 confidenceScore×0.3, +15 known sport, +10 preferred sport match |
| `risk` | 0 | 100 if DNC; +45 cooldown active, +40 not_interested, +30 wrong_contact, +25 sent ≥ 5 |

**`NextBestAction` — actionType values:**
```typescript
"send_initial_email" | "generate_draft" | "send_follow_up" |
"wait" | "mark_interested" | "create_deal" | "schedule_call" |
"generate_response" | "create_proposal" | "mark_do_not_contact" | "stop_sequence"
```
Priority: `"low" | "medium" | "high" | "urgent"`

Each `NextBestAction` includes a `DecisionExplanation` with `decision_reason`, `supporting_signals[]`, `risk_flags[]`, `confidence_level`, `expected_outcome`, and `alternative_action`. This explanation is surfaced to the admin in the Prospect Intelligence panel.

---

### 8j. Conversation Stage

**Source:** `server/email-agent/conversation-stage.ts`

**Purpose:** Pure functions for computing and describing a prospect's current conversation stage. No I/O.

**`ConversationStage` type:**
```typescript
type ConversationStage =
  | "cold" | "contacted" | "engaged" | "interested"
  | "deal_open" | "proposal" | "won" | "lost" | "do_not_contact"
```

**Stage determination logic (`computeConversationStage()`):**

| Condition | Stage |
|---|---|
| `outreachStatus === "Do Not Contact"` | `do_not_contact` |
| Deal exists with `status === "won"` | `won` |
| Deal exists with `status === "lost"` | `lost` |
| Deal with `status === "proposal_sent"` or `"negotiating"` | `proposal` |
| Any other active deal | `deal_open` |
| Replied + classified `interested` or `ask_info` | `interested` |
| Replied + classified `not_interested` | `lost` |
| Replied + classified `wrong_contact` | `do_not_contact` |
| Replied + classified `referral` | `engaged` |
| Any reply (other) | `engaged` |
| Sent ≥ 1 + (opened ≥ 2 or clicked) | `engaged` |
| Sent ≥ 1 | `contacted` |
| No sends | `cold` |

**Sending blocked for stages:** `do_not_contact`, `lost`, `won` — checked via `getStageSendingBlocked(stage)`.

**`getStageMessageingGuidance(stage): string`** — returns messaging guidance string per stage; injected into draft generation.

---

### 8k. Contact Quality

**Source:** `server/email-agent/contact-quality.ts`

**Purpose:** Scores a prospect's contact email quality with no I/O (pure functions).

**`computeContactQualityScore(prospect): ContactQuality`**

**`ContactQuality` shape:**
```typescript
{
  score: number;    // 0–100
  reason: string;
  tier: "high" | "medium" | "low" | "missing";
}
```

**Tier score mapping:**

| Internal tier | Score | External `tier` | Reason |
|---|---|---|---|
| `direct_coach` | 92 | `"high"` | Direct coach email — highest deliverability |
| `athletic_director` | 80 | `"high"` | Athletic director — decision maker with budget |
| `athletics_dept` | 62 | `"medium"` | Department email — may be filtered |
| `generic` | 38 | `"low"` | Generic inbox (info@, office@, admin@, etc.) |
| `invalid` | 0 | `"missing"` | Invalid or missing email |

**Tier detection logic (`detectEmailTier()`):** First checks `contactRole` string for known role keywords; then checks email local-part for `coach`, `trainer`, `strength`, `ad`, `athletics`, `director`; then checks for generic prefixes (`info`, `office`, `admin`, `contact`, `hello`, `general`, `school`, `main`). Defaults to `athletics_dept` if format is valid but no pattern matches.

**Consumers:** `buildProspectContext()`, `scheduled-email-agent.ts` (injects `contactQualityScore` into draft generation prompt)

---

### 8l. Revenue Outcome Engine

**Source:** `server/email-agent/revenue-outcome-engine.ts`

**Purpose:** Ties every AI action to real revenue outcomes via `ai_revenue_events` with multi-touch attribution.

**Exported functions:**
- `logActionAsEvent(orgId, data): Promise<void>` — creates a pending `ai_revenue_events` record; called at the moment of send
- `attributeOutcomeToProspect(orgId, prospectId, status, value, source): Promise<void>` — updates the most recent pending event for a prospect; for `won` outcomes, triggers the multi-touch chain
- `logMultiTouchAttributionChain(orgId, prospectId, wonValue, source): Promise<void>` — Phase 7 multi-touch attribution
- `getRevenueOutcomes(orgId): Promise<RevenueOutcomes>` — aggregated stats for the Revenue Outcomes tab
- `buildRevenueContextString(outcomes): string` — formats revenue context for injection into AI system prompts

**Multi-touch attribution logic:**
- On a `won` outcome, fetches all prior pending `ai_revenue_events` for the prospect
- Assigns a shared `attributionChainId` (UUID)
- **Equal-split credit:** `equalShare = Math.round(wonValue / totalTouches)`; primary touch gets the remainder so shares sum exactly to `wonValue`
- Most recent prior event = `attributionRole: "primary"`; all earlier events = `attributionRole: "assist"`
- `outcomeValue` on primary event = full deal value (for reference); `creditedValue` on every event = fractional share (prevents double-counting)

**`RevenueOutcomes` shape:**
```typescript
{
  today: RevenueStatPeriod;
  week: RevenueStatPeriod;
  month: RevenueStatPeriod;
  autoVsManual: { autoCount, manualCount, autoRevenue, manualRevenue, autoMultiplier };
  byActionType: { actionType, count, revenue, avgRevenue }[];
  impactFeed: ImpactFeedItem[];
  streaks: { daysStreak: number; weeklyWins: number };
  recentlyAttributed: ImpactFeedItem[];
}
```

**Wiring:** `logActionAsEvent()` is called in the follow-up cron and the scheduled email agent immediately after a successful guarded send. `attributeOutcomeToProspect()` is called from the deal close/update endpoint when a prospect's deal moves to `"won"`.

---

## Data Flow

### Outbound Email Send Path

```
Admin triggers OR 8:30 AM cron fires
    │
    ▼
scheduled-email-agent.ts: buildDailyOutreachQueue()
    │
    ├── DNC/opted-out check → skip (log BLOCKED trigger event)
    ├── Collision detection (detectTriggerCollision, 5-min window)
    │
    ▼
Draft generation (generateOutreachEmailFromVariant or generateOutreachEmail)
  + stage context injection (computeConversationStage, getStageMessageingGuidance)
  + contact quality injection (computeContactQualityScore)
    │
    ▼
evaluatePolicy() [autonomy-policy-engine.ts]
  → "blocked"           → skip, log POLICY_BLOCKED
  → "approval_required" → insert gmail_agent_actions proposed row, skip send
  → "auto_execute"      → continue
    │
    ▼
guardedSendTeamTrainingOutreachEmail() [guarded-outbound-email.ts]
  → blocked             → skip, log POLICY_BLOCKED
  → sent                → continue
    │
    ▼
Update outreachDraft.sentAt + prospect.outreachStatus = "Contacted"
logOutreachEvent(eventType: "sent")
scheduleFollowUpsForDraft() [follow-up-cron.ts]
logActionAsEvent() [revenue-outcome-engine.ts]
```

### Follow-Up Path

```
Hourly cron tick (follow-up-cron.ts)
    │
    ▼
Per-org: acquireJobLock("follow_up_cron", 55 min)
    │
    ▼
getDueFollowUps(orgId)
    │
    ├── Atomic row claim (UPDATE ... WHERE status='pending' RETURNING id)
    ├── Prospect exists + has email
    ├── Not DNC, not Replied
    ├── No active deal
    ├── Not opted out
    ├── stepNumber <= MAX_FOLLOW_UPS (3)
    │
    ▼
Generate follow-up body (opener rotation + engagement-aware closing line)
    │
    ▼
evaluatePolicy() [autonomy-policy-engine.ts]
    │
    ▼
guardedSendTeamTrainingOutreachEmail()
    │
    ▼
createOutcomeOnSend() [fire-and-forget]
releaseJobLock()
```

### CEO Orchestrator Path

```
Admin chat input
    │
    ▼
ceo-agent-orchestrator.ts: runOrchestrator()
    │
    ▼
GPT-4o: classify intent
    │
    ├── route to scheduling agent
    ├── route to growth/apex agent
    ├── route to retention/pulse agent
    └── route to general synthesis
    │
    ▼
Collect sub-agent outputs
    │
    ▼
GPT-5.1 (or GPT-4o fallback): stream synthesized reply via SSE
    │
    ▼
Write to decision_journal_entries [decision-journal-service.ts]
```

---

## Dependencies

### Internal

| Dependency | Used By |
|---|---|
| `server/services/autonomy-policy-engine.ts` | scheduled-email-agent, follow-up-cron, auto-execution-engine |
| `server/services/agentmail-send-guard.ts` | All guarded send paths |
| `server/services/guarded-outbound-email.ts` | scheduled-email-agent, follow-up-cron |
| `server/services/agent-dead-letter-service.ts` | follow-up-cron (exception handler) |
| `server/services/ceo-heartbeat-service.ts` | follow-up-cron (`acquireJobLock`, `releaseJobLock`) |
| `server/services/outcome-intelligence-service.ts` | follow-up-cron (`createOutcomeOnSend`) |
| `server/services/decision-journal-service.ts` | ceo-agent-orchestrator |
| `server/reliability-routes.ts` | follow-up-cron (`logSystemEvent`) |
| `server/team-training-prospecting.ts` | scheduled-email-agent, follow-up-cron (email generation) |
| `server/storage.ts` | All email-agent files |
| `@shared/schema` | `gmailAgentActions`, `appSettings`, `email_trigger_events` |

### External

| Service | Used By | Purpose |
|---|---|---|
| OpenAI GPT-4o | CEO Orchestrator, Scheduling Agent, Reply Classifier | Intent classification, tool calling, reply classification |
| OpenAI GPT-5.1 | CEO Orchestrator | Streaming synthesis (falls back to GPT-4o) |
| OpenAI (generation model) | scheduled-email-agent, follow-up-cron | Draft generation |
| SendGrid | All send paths (via guarded-outbound-email) | Actual email delivery |

---

## Security Considerations

### Authentication

- Agent cron jobs run in the server process with no user session — they use `orgId` from the database directly
- The CEO Orchestrator endpoint requires admin authentication (verified via `user_profiles.role`)
- Apex/Pulse agent routes define a **local `requireAdmin` helper** — `requireRole` is not exported from `routes.ts` and cannot be imported by external route files

### Authorization

- All automated email operations include `org_id` in every database WHERE clause for multi-tenant isolation
- The atomic row claim in `follow-up-cron.ts` includes `AND org_id = $orgId` to prevent cross-tenant races
- Policy engine is org-scoped: `evaluatePolicy({ orgId, ... })`

### Data Ownership

- Each org's follow-ups, drafts, and outreach events are strictly isolated by `org_id`
- `apex_recommendations` and `pulse_recommendations` are raw-SQL tables (not in Drizzle schema); they include `org_id` but lack foreign key enforcement — callers are responsible for correct scoping

### Validation

- All automated sends go through the Autonomy Policy Engine (11-check evaluator) before reaching the Send Guard
- Policy evaluation errors are **fail-closed** — any exception from `evaluatePolicy()` causes the action to be treated as `approval_required`, never `auto_execute`
- Daily send cap enforced at both the per-org settings level and the auto-execution engine level (hard cap: 3 auto-executions/day, 10 total sends/day)

---

## Failure Modes

### Policy Engine Unreachable

- **Behavior:** `evaluatePolicy()` throws; catch block returns `{ decision: "approval_required" }` with reason `"Policy evaluation error — defaulting to approval_required"`
- **Effect:** Send is queued for human approval; no email is sent autonomously
- **Recovery:** Admin reviews the AI Approvals queue; no automated retry

### Dead-Letter Queue

- **Trigger:** Any exception in the follow-up cron exception handler
- **Behavior:** `pushToDeadLetter({ jobName: "follow_up_cron", orgId, error, payload })` writes the failed job; `logSystemEvent("error", ...)` writes to the system event log
- **Recovery:** Dead-letter items are visible in the admin reliability dashboard; manual re-trigger is required

### Duplicate Send Race

- **Trigger:** follow-up-cron and auto-execution-engine both pick up the same `email_follow_ups` row in the same tick
- **Prevention:** Atomic `UPDATE ... WHERE status='pending' RETURNING id` — only one worker gets the row; the other sees `claimedRows.length === 0` and skips
- **Note:** `blockReason` is written as `"COOLDOWN_ACTIVE"` for the skipped path (misleading label — this is actually a race dedup, not a cooldown)

### Job Lock Contention

- **Trigger:** `acquireJobLock()` returns `acquired: false` (lock held by a prior tick still running)
- **Behavior:** Org is silently skipped for this tick; written to timeline via `writeTimeline` with `!acquired` guard
- **Note:** `releaseJobLock()` must use DELETE (not UPDATE to "released") — otherwise the same lock key blocks the next manual run within the 28-minute time window

### Table Does Not Exist

- **Trigger:** `apex_recommendations` or `pulse_recommendations` queried before `ensureApexRecommendationsTable()` / `ensurePulseRecommendationsTable()` has run
- **Behavior:** SQL error surfaces in CEO Heartbeat run; Apex/Pulse sections of the heartbeat fail with "relation does not exist"
- **Recovery:** Tables are self-provisioned on agent startup — ensure the agent initialization order in `server/index.ts` runs before the first heartbeat cycle

---

## Performance Considerations

### Scalability

- All cron jobs are per-org; multi-org parallelism is not used — orgs run sequentially within each cron tick. This is safe for the current scale but will become a bottleneck at high org counts.
- Daily email agent polls every 60 seconds to check if it's 8:30 AM. This is inexpensive but means orgs could be up to 60 seconds late on their daily run.

### Caching

- `buildDailyOutreachQueue()` is called fresh each day; results are not cached
- Prospect context (`buildProspectContext()`) is built on-demand per request; not cached

### Concurrency

- `followUpCronIsRunning` boolean prevents overlapping cron ticks (global guard)
- `dailyJobRunning` boolean prevents overlapping daily email agent runs (global guard)
- Per-org job locks (`acquireJobLock`) prevent the same org running concurrently across ticks

### Indexes

- `email_follow_ups` is queried by `(org_id, status, scheduled_for)` — no index is explicitly created by the Email Agent; relies on Drizzle schema-level indexes if any exist
- `apex_recommendations` and `pulse_recommendations` are raw-SQL tables — no migration file ensures indexes; query performance for large result sets is not guaranteed

---

## Future Improvements

### Known Technical Debt

- `blockReason: "COOLDOWN_ACTIVE"` is used for the duplicate-send race skip path (misleading — should be `"CONCURRENT_WORKER_CLAIMED"`)
- `growth-agent.ts` and `retention-agent.ts` v1 adapters add a file-level indirection layer with no other value; candidates for deletion once all callers reference the v2 names directly
- `apex_recommendations` and `pulse_recommendations` tables are raw SQL outside Drizzle schema; they have no migration file and no foreign-key enforcement

### Planned Evolution

- Parallel org processing in the daily email agent (currently sequential)
- Multi-model intent routing (route simpler intents to faster, cheaper models)
- Agent-to-agent direct communication (currently mediated only through shared DB tables and the Global Priority Engine)

---

## Related Documentation

- `docs/schema.md` — all Drizzle table definitions including `email_trigger_events`, `gmail_agent_actions`, `ai_revenue_events`
- `docs/core-services.md` — HTTP route registration, storage interface, middleware stack
- `server/agent-identities.ts` — canonical agent identity registry (source of truth)
- `server/services/autonomy-policy-engine.ts` — 11-check policy evaluator referenced throughout this document

---

## Architecture Discrepancies

Issues found when comparing source code against `CLAUDE.md` or `replit.md` documentation:

1. **`replit.md` describes "Unified Business Agent" as combining AI Scheduling Assistant and Team Training Prospecting Agent** — no file named `unified-business-agent.ts` was found. The CEO Orchestrator (`ceo-agent-orchestrator.ts`) is the closest match. The "Unified Business Agent" description in `replit.md` likely refers to the Orchestrator; the name should be updated.

2. **`replit.md` states the Hermes table is `hermes_auto_learnings`** (noted in memory) — consistent with source. No discrepancy.

3. **v1 adapter files are undocumented in `replit.md`** — `server/agents/retention-agent.ts` and `server/agents/growth-agent.ts` exist as backwards-compat wrappers. `replit.md` makes no mention of this. Any caller that passes `retention_agent` or `growth_agent` as an `actorType` should be audited.

4. **`replit.md` mentions "Email Agent Upgrade (Phases 1-10)"** but the source code shows the scheduled email agent runs Phase 9 context injection; no Phase 10 file was identified in `server/email-agent/`. The phase numbering in comments within source files may not match the `replit.md` phase list exactly.

5. **Contact quality tier naming differs between `contact-quality.ts` and `replit.md`** — `replit.md` (Architecture decisions section) describes tiers as `decision_maker > role_based > general > missing`. The actual source code uses `direct_coach > athletic_director > athletics_dept > generic > invalid`. These are different tier taxonomies; `replit.md` describes the enrichment-layer tiers (`enrichProspectContact`), while `contact-quality.ts` defines the local scoring tiers.

---

## Recommended CLAUDE.md Updates

1. **Add agent identity names to CLAUDE.md:** The 9 canonical `agentId` values (`executive_agent`, `retention_agent`, etc.) and their display names (Atlas, Pulse, Apex, etc.) are not documented in CLAUDE.md. Future agents must use one of these 9 identities when writing to `unified_agent_action_log`.

2. **Document the fail-closed policy pattern:** Any future automated send path must implement the same fail-closed pattern: `evaluatePolicy().catch(() => ({ decision: "approval_required" }))`. This is the established standard and should be in CLAUDE.md.

3. **Document `requireRole` export restriction:** `requireRole` is only defined in `server/routes.ts` and is NOT exported. All external route files (apex-agent-routes, pulse-agent-routes, etc.) must define a local `requireAdmin` helper. This trips up new contributors.

4. **Document raw-SQL agent tables:** `apex_recommendations` and `pulse_recommendations` are not in Drizzle schema. CLAUDE.md should note which tables are raw-SQL only and require `ensureTable()` initialization on startup.

5. **Clarify "Unified Business Agent" naming:** `replit.md` uses this term but the implementation is `ceo-agent-orchestrator.ts`. CLAUDE.md should map the marketing name to the actual file.

---

## Files Reviewed

| File | Lines Read | Notes |
|---|---|---|
| `server/agent-identities.ts` | All | 9 identities confirmed |
| `server/agents/executive-agent.ts` | All | Atlas orchestrator + business brain cron |
| `server/agents/apex-agent.ts` | All | Growth agent; self-provisions `apex_recommendations` |
| `server/agents/pulse-agent.ts` | All | Retention agent; self-provisions `pulse_recommendations` |
| `server/agents/retention-agent.ts` | All | V1 adapter → Pulse |
| `server/agents/growth-agent.ts` | All | V1 adapter → Apex |
| `server/agents/client-success-agent.ts` | All | Client health scoring |
| `server/agents/scheduling-agent.ts` | All | 6 tool functions; durationMinutes max=480 |
| `server/ceo-agent-orchestrator.ts` | All | Intent classification + SSE streaming |
| `server/email-agent/scheduled-email-agent.ts` | All | Daily 8:30 AM email agent |
| `server/email-agent/follow-up-cron.ts` | All | Hourly follow-up processor |
| `server/email-agent/auto-execution-engine.ts` | All | Max 3/day; safe types only |
| `server/email-agent/global-priority-engine.ts` | All | Cross-agent action ranking |
| `server/email-agent/reply-classifier.ts` | All | 7 classification types |
| `server/email-agent/audit-engine.ts` | All | Health audit |
| `server/email-agent/trigger-logger.ts` | All | Decision records for all evaluations |
| `server/email-agent/trigger-alerts.ts` | All | Proactive alert generation |
| `server/email-agent/contextual-intelligence.ts` | All | Prospect scoring + NextBestAction |
| `server/email-agent/conversation-stage.ts` | All | 9-stage conversation model |
| `server/email-agent/contact-quality.ts` | All | 4-tier contact scoring |
| `server/email-agent/revenue-outcome-engine.ts` | All | Multi-touch attribution |
| `docs/_template.md` | All | Formatting compliance |
| `docs/schema.md` | Headers | Cross-reference only |
| `docs/core-services.md` | Headers | Cross-reference only |

---

## Confidence Assessment

**Overall confidence: High**

- Agent identity registry: **Verified** — all 9 identities confirmed directly from `server/agent-identities.ts`
- Cron schedules and constants: **Verified** — `BASE_FOLLOW_UP_DAYS`, `MAX_FOLLOW_UPS`, 8:30 AM window, hourly follow-up interval all confirmed from source
- Safety gate order and fail-closed behavior: **Verified** — `evaluatePolicy().catch(...)` pattern confirmed in both `scheduled-email-agent.ts` and `follow-up-cron.ts`
- Multi-touch attribution logic: **Verified** — equal-split formula and `creditedValue` confirmed from `revenue-outcome-engine.ts`
- Intelligence score formulas: **Verified** — warmth/urgency/fit/risk coefficient values confirmed from `contextual-intelligence.ts`
- Contact quality tier scores: **Verified** — score values (92/80/62/38/0) confirmed from `contact-quality.ts`
- v1 adapter status: **Verified** — confirmed `retention-agent.ts` and `growth-agent.ts` delegate entirely to v2 implementations
- Auto-execution safe-type list: **Verified** — `["send_follow_up", "generate_draft", "send_initial_email"]` confirmed from `auto-execution-engine.ts`

**Gaps:**
- `server/agents/apex-agent-routes.ts` and `server/agents/pulse-agent-routes.ts` were not read; route endpoints for these agents are not cataloged here
- `server/email-agent/trigger-alerts.ts` alert type list was not exhaustively verified (file was read but alert shape details not fully extracted)
- Scheduling agent tool function signatures were read from source but the full OpenAI function-calling JSON schema for each tool was not captured

---

## Last Updated

Date: 2026-06-28

Author: Engineering (generated from source — Verified Against Source)

Version: 1.0
