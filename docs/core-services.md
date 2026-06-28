# Core Services Reference

**Document Type:** Implementation
**Verification Status:** Verified Against Source
**Primary Sources:** `server/financial-metrics.ts`, `server/email.ts`, `server/services/` (80 files), `server/email-agent/` (12 files), `server/agents/` (7 files)
**Generated:** 2026-06-28

---

## Table of Contents

1. [Service Layer Overview](#1-service-layer-overview)
2. [Financial & Revenue Services](#2-financial--revenue-services)
3. [Communication Safety Stack](#3-communication-safety-stack)
4. [Email Delivery Layer](#4-email-delivery-layer)
5. [Gmail Agent Services](#5-gmail-agent-services)
6. [Email Agent Sub-System (`server/email-agent/`)](#6-email-agent-sub-system-serveremail-agent)
7. [Message Learning & Outcome Intelligence](#7-message-learning--outcome-intelligence)
8. [Athlete Intelligence Services](#8-athlete-intelligence-services)
9. [Lead & Intake Pipeline](#9-lead--intake-pipeline)
10. [AI Memory: Obsidian & Hermes](#10-ai-memory-obsidian--hermes)
11. [Forecasting & Digital Twin](#11-forecasting--digital-twin)
12. [CEO Heartbeat & Agent Orchestration](#12-ceo-heartbeat--agent-orchestration)
13. [Agent Quality & Safety Infrastructure](#13-agent-quality--safety-infrastructure)
14. [Notification & Activity Automation](#14-notification--activity-automation)
15. [Named Agents (`server/agents/`)](#15-named-agents-serveragents)
16. [Opportunity Acquisition Agents](#16-opportunity-acquisition-agents)
17. [Software Improvement Agent](#17-software-improvement-agent)
18. [Architecture Discrepancies](#architecture-discrepancies)
19. [Recommended CLAUDE.md Updates](#recommended-claudemd-updates)
20. [Files Reviewed](#files-reviewed)
21. [Confidence Assessment](#confidence-assessment)

---

## 1. Service Layer Overview

### Directory Layout

```
server/
├── financial-metrics.ts            # Unified financial metrics (not in services/)
├── email.ts                        # Core SendGrid delivery (not in services/)
├── db.ts                           # Drizzle DB client
├── services/                       # ~80 service modules
├── email-agent/                    # 12 email-agent intelligence modules
├── agents/                         # 7 named autonomous agents
└── [routes].ts                     # Route files (not documented here)
```

### Service Registration

Services are **not registered or injected** — they are plain TypeScript modules with named exports. Callers import functions directly. There is no service container, IoC framework, or singleton registry.

### Startup Wiring

The following services start background processes when called from `server/index.ts`:

| Function | File | What It Starts |
|----------|------|----------------|
| `startCeoHeartbeat()` | `services/ceo-heartbeat-service.ts` | 30-min heartbeat cron |
| `startBusinessBrainCron()` | `agents/executive-agent.ts` | Business brain cron |
| `startApexDailyCron()` | `agents/apex-agent.ts` | Apex recommendations cron |
| `startPulseDailyCron()` | `agents/pulse-agent.ts` | Pulse cron |
| `initializeFollowUpCron()` | `email-agent/follow-up-cron.ts` | Team-training follow-up cron |
| `initializeScheduledEmailAgent()` | `email-agent/scheduled-email-agent.ts` | Daily email cron |
| `startLeadRecoveryCron()` | `services/lead-recovery-cron.ts` | Lead recovery cron |
| `startObsidianSyncCron()` | `services/obsidian-sync-service.ts` | Obsidian queue processor |
| `runDailyAthleteContextRefreshCron()` | `services/athlete-context-broker.ts` | Athlete context refresh cron |

### Key Design Constraints

- **No service calls `db` from outside `server/`**. The Drizzle client (`server/db.ts`) is import-private to the server.
- **Services do not call each other in cycles**. The dependency graph flows: agents → services → db.
- **All dangerous AI actions require approval.** Services either write `approval_required` status or pass through the guard chain before sending.

---

## 2. Financial & Revenue Services

### `server/financial-metrics.ts`

**The single source of truth for all financial aggregations.** No dashboard, agent, command center, or heartbeat should compute revenue independently.

#### Rule

> No caller should sum `bookings.priceCents` for money figures. All financial metrics must flow through `computeUnifiedFinancialMetrics()`.

#### Payment Sources Aggregated

| Source | What It Measures |
|--------|-----------------|
| `revenue_ledger_events` | Canonical double-entry ledger (authoritative) |
| `wallet_transactions` | Stripe-connected online payments |
| `bookings.paymentMethod` | Offline cash/Venmo (breakdown only) |

#### Exports

| Function | Signature | Notes |
|----------|-----------|-------|
| `zeroMetrics` | `(orgId?) → UnifiedFinancialMetrics` | Safe default / fallback |
| `computeUnifiedFinancialMetrics` | `(orgId, opts?) → UnifiedFinancialMetrics` | **Primary entry point** |
| `computeMonthlyFinancialMetrics` | `(orgId) → UnifiedFinancialMetrics` | Current calendar month |
| `computeTodayFinancialMetrics` | `(orgId) → UnifiedFinancialMetrics` | Today only |
| `computeRolling30DayMetrics` | `(orgId) → { metrics, growth }` | Rolling 30-day with growth rate |
| `buildFinancialContextString` | `(metrics) → string` | Formats metrics for AI prompt injection |

#### `UnifiedFinancialMetrics` Fields

| Field | Type | Description |
|-------|------|-------------|
| `cashCollected` | number (cents) | Sum of `payment_received` in ledger — canonical total |
| `stripeCollected` | number (cents) | Wallet CREDIT transactions linked to Stripe PaymentIntent |
| `walletDebited` | number (cents) | Wallet DEBIT from redemptions |
| `cashCollectedOffline` | number (cents) | COMPLETED bookings with `paymentMethod=CASH` |
| `venmoCollected` | number (cents) | COMPLETED bookings with `paymentMethod=VENMO` |
| `totalCollected` | number (cents) | Sum of all collected |
| `recognizedRevenue` | number (cents) | Service actually delivered |
| `deferredRevenue` | number (cents) | Prepaid but undelivered liability |
| `pipelineRevenue` | number (cents) | CONFIRMED future bookings — scheduling pipeline, NOT earned |
| `sessionsDelivered` | number | COMPLETED bookings in period |
| `sessionsRedeemed` | number | Redemption rows created in period |
| `sessionsRemaining` | number | Active subscription credits |
| `refunds` | number (cents) | `refund_issued` events |
| `coachCompAccrued` | number (cents) | `coach_compensation_accrued` events |
| `coachCompPaid` | number (cents) | `coach_compensation_paid` events |
| `ledgerCoverage` | `"full" \| "partial" \| "none"` | Data quality signal |

**Safety:** This service is strictly **read-only**. It never writes to any table.

---

## 3. Communication Safety Stack

These services form a layered guard chain that wraps all outbound email. Every outbound path must pass through at least one layer.

### Guard Chain Diagram

```
Automated cron / agent action
        ↓
guarded-outbound-email.ts  ← wraps ALL automated SendGrid calls
  ├── send-guard-service.ts  (emergency pause, suppression, daily cap)
  ├── communication-coordination-service.ts  (24-hour cross-channel window)
  └── outbound-audit-log.ts  (immutable send record)

Human-approved "Send" click
        ↓
send-guard-service.ts  (3 baseline checks, applies even on human clicks)
        ↓
agentmail-send-guard.ts  (AgentMail-specific path — automated sends only)
        ↓
autonomy-policy-engine.ts  (11-check evaluator for auto-execute vs. approval_required)
```

---

### `server/services/autonomy-policy-engine.ts`

Evaluates whether an agent action can auto-execute. The **decision engine** for all AI communication autonomy.

**Decision outputs:** `auto_execute` | `approval_required` | `blocked`

**Checks performed (11 total):**

1. `autoSendFirstResponse` enabled?
2. Confidence ≥ `minAutoSendConfidence` threshold?
3. Risk level ≤ `maximum_allowed_risk_level`?
4. Not suppressed / opted-out?
5. Daily email cap not exceeded?
6. Within allowed send window (`allowedSendWindowStart` / `End`)?
7. Not a first contact requiring approval?
8. Not a new recipient requiring approval?
9. No sensitive language detected in body?
10. Not a duplicate action (idempotency check)?
11. `allowAutonomousCommunication` enabled in governance?

Every evaluation is logged to `agent_autonomy_decisions`.

**Policy version:** `1.0.0` (tracked in `org_automation_settings.policy_version`)

**Key exports:**

| Function | Description |
|----------|-------------|
| `evaluatePolicy(input: PolicyInput)` | Primary entry point — runs all 11 checks |
| `POLICY_VERSION` | Current policy version string |

**Types:**

- `PolicyInput` — `{ orgId, actionType, confidence, riskLevel, recipientEmail, bodyText, isFirstContact, ... }`
- `PolicyDecision` — `{ decision, reasons[], confidence, riskLevel, policyVersion, evaluatedAt, decisionId? }`

---

### `server/services/agentmail-send-guard.ts`

Centralized policy gate for **AgentMail automated sends** only. Sits in front of `sendAgentEmail()` and `replyFromAgentInbox()`.

**Decision hierarchy:**
1. Emergency pause active → **BLOCK** (hardest stop — cannot be overridden)
2. `neverAutoSend=true` + `humanApproved=false` → **BLOCK**
3. `allowAutonomousCommunication=false` + `humanApproved=false` → **BLOCK**
4. Otherwise → **ALLOW**

**Key:** `humanApproved=true` bypasses checks 2 and 3 but **never** bypasses emergency pause.

Blocked sends are written to `outbound_email_audit_log` (never throws).

**Exports:**

| Function | Description |
|----------|-------------|
| `checkAgentMailSendPolicy(ctx: SendGuardContext)` | Returns `{ allowed, reason, policyDecision }` |

---

### `server/services/send-guard-service.ts`

Three baseline safety checks applied even on **human-approved** send paths.

**Checks:**
1. Emergency pause (org-wide halt for compliance/legal)
2. Suppression / opt-out (recipient requested no contact)
3. Daily email cap (prevents burst via UI)

All checks are **fail-open** (safe default) if the DB is unreachable.

**Export:**

| Function | Description |
|----------|-------------|
| `checkHumanApprovedSendGuards(orgId, recipientEmail)` | Returns `{ blocked, reason?, blockType? }` |

---

### `server/services/guarded-outbound-email.ts`

Wraps **all automated SendGrid outreach sends** (follow-up cron, auto-execution-engine, scheduled-email-agent). The guard chain applied:

1. Emergency pause
2. Suppression / opt-out
3. Daily email cap
4. Cross-channel 24-hour window (via `communication-coordination-service.ts`)
5. Audit log write

**Scope exclusion:** Transactional emails (booking confirmations, reminders, password resets) bypass this wrapper — they have inline guards and are not subject to outreach daily caps.

**Key exports:**

| Function | Description |
|----------|-------------|
| `guardedSendTeamTrainingOutreach(opts: GuardedSendOpts)` | Guarded team-training outreach send |
| `guardedSendAgentOutreach(opts: GuardedSendOpts)` | Guarded general agent outreach send |

**`GuardedSendOpts` key fields:** `orgId`, `recipientEmail`, `subject`, `body`, `sourceSystem`, `triggeredBy` (`cron` / `auto_execute` / `agent_tool` / `human_approved`), `emailType`, `policyDecision`

---

### `server/services/outbound-audit-log.ts`

Immutable write-only log of every outbound email attempt (sent or blocked).

**Export:**

| Function | Description |
|----------|-------------|
| `writeOutboundAuditLog(entry: AuditLogEntry)` | Writes to `outbound_email_audit_log` (raw SQL table) |
| `queryOutboundAuditLog(opts)` | Read query for admin dashboard |

---

### `server/services/communication-coordination-service.ts`

Prevents cross-channel email storms by enforcing a 24-hour quiet window per recipient.

**Exports:**

| Function | Description |
|----------|-------------|
| `getRecentOutboundForRecipient(email, orgId)` | Fetches recent outbound records for a recipient |
| `shouldSuppressCrossChannelSend(orgId, recipientEmail)` | Returns `{ suppressed, reason, lastTouchAt }` |
| `recordOutboundTouch(orgId, recipientEmail, channel)` | Records a send to enforce the quiet window |
| `getLastTouchSummary(orgId, recipientEmail)` | Summary of last cross-channel touch |

---

## 4. Email Delivery Layer

### `server/email.ts`

Core SendGrid integration. All transactional email sending flows through this file. **Not in `server/services/`.**

**Design:** Credentials are loaded from `SENDGRID_API_KEY` env var via `getCredentials()`. Org branding is applied via the `OrgBranding` interface (name, logo, primary color, etc.).

**Transactional send functions:**

| Function | Trigger |
|----------|---------|
| `sendWelcomeEmail` | New client signup |
| `sendCoachWelcomeEmail` | Coach invite activation |
| `sendBookingConfirmationToClient` | Booking created/confirmed |
| `sendBookingNotificationToCoach` | New booking for coach |
| `sendCashoutRequestEmail` | Payout request |
| `sendPaymentConfirmationEmail` | Payment collected |
| `sendSessionChargeEmail` | Session charged |
| `sendWeeklyReminderEmail` | Weekly cron |
| `sendGroupSessionJoinConfirmation` | Group session booking |
| `sendGroupSessionJoinNotification` | Group session — admin notice |
| `sendTeamQuoteEmail` | Team quote sent |
| `sendTeamTrainingRequestEmail` | Team training inquiry |

**Suppression helpers (in-memory, ephemeral):**

| Function | Description |
|----------|-------------|
| `suppressBookingConfirmation(email)` | Prevents duplicate booking confirmation in-process |
| `suppressNotificationType(email, type)` | Prevents a specific notification type for a recipient |

**Utility:**

| Function | Description |
|----------|-------------|
| `isEmailProviderConfigured()` | Returns true if `SENDGRID_API_KEY` is set |
| `validateEmailProvider()` | Tests the SendGrid connection |
| `getUncachableSendGridClient()` | Returns a fresh SendGrid client (bypasses any caching) |

> **Note:** `sendTeamTrainingOutreachEmail()` and `sendAgentOutreachEmail()` are also in this file and are the underlying senders called by `guarded-outbound-email.ts`. Callers must **not** call these directly — they must go through the guard wrappers.

---

### `server/services/agentmail-service.ts`

Manages AgentMail inboxes used by AI agents for outbound/inbound email via a dedicated third-party email infrastructure (not SendGrid).

**Key constants:**

```typescript
export const AGENT_INBOXES = [
  // Array of inbox address configurations
]
```

**Exports:**

| Function | Description |
|----------|-------------|
| `isAgentMailConfigured()` | Returns true if AgentMail env vars are set |
| `logAgentMailMessage(record)` | Writes to AgentMail audit log |
| `verifyAgentMailConnection()` | Health check |
| `listInboxes()` | Lists all configured inboxes |
| `createOrVerifyInbox(localPart)` | Idempotent inbox creation |
| `getInboxMessages(inboxAddress, limit)` | Fetches messages from inbox |
| `sendAgentEmail(params)` | **Guarded** — calls `checkAgentMailSendPolicy()` before sending |
| `replyFromAgentInbox(params)` | **Guarded** — calls `checkAgentMailSendPolicy()` before replying |
| `handleAgentMailWebhook(payload)` | Processes inbound webhook events |

---

### `server/services/agentmail-inbound-router.ts`

Classifies inbound emails and routes them to the correct downstream handler. **No outbound emails are sent automatically.**

**Classification types:** `new_lead`, `booking_request`, `reschedule_request`, `cancellation_request`, `pricing_question`, `employment_candidate`, `support_issue`, `billing_issue`, `athlete_parent_question`, `coach_partner_inquiry`, `software_bug_report`, `urgent_escalation`, `general_question`, `spam_or_noise`

**Exports:**

| Function | Description |
|----------|-------------|
| `extractIntentSignals(subject, body)` | Returns intent keyword signals |
| `classifyInboundEmail(payload)` | Returns `ClassificationResult` with type + confidence |
| `resolveOrgFromInbox(toEmail)` | Maps inbox address → org ID |
| `processInboundAgentMail(payload)` | Full routing: classify → create records → write timeline |
| `mapInboxToDefaultAgent(inbox)` | Returns the default agent for an inbox address |

---

### `server/services/agentmail-followup-service.ts`

Manages AgentMail follow-up sequences. After the first outbound send, this service schedules and executes a configurable follow-up sequence.

**Sequence rules** (`SEQUENCE_RULES`): Per-lead-type configuration defining delay, max attempts, subject prefix, and stop conditions.

**Exports:**

| Function | Description |
|----------|-------------|
| `generateFollowupDraft(params)` | AI-generates a follow-up email draft |
| `detectStopConditions(params)` | Returns true if follow-up should stop (reply, opt-out, conversion, etc.) |
| `createFollowupSequence(params)` | Creates the sequence record after initial send |
| `cancelFollowupsForThread(params)` | Cancels all pending follow-ups for a thread |
| `markFollowupSkipped(id, reason)` | Marks a follow-up as skipped |
| `processDueFollowups()` | Cron tick: processes all due follow-up records |
| `sendApprovedFollowup(params)` | Sends a follow-up that was approved by a human |

---

## 5. Gmail Agent Services

### `server/services/gmail-agent-service.ts`

Provides authenticated Gmail API access for the TrainEfficiency agent. Credentials are loaded from the org's `external_integrations` row, decrypted via `credentials-vault`, and never exposed outside this module.

**Architecture:** The service is org-scoped — each function takes `orgId` and loads credentials from the DB at call time. There is no shared session token.

**Reply intents classified:** `interested`, `wants_more_info`, `wants_schedule`, `objection`, `not_interested`, `wrong_person`, `unsubscribe`, `spam`, `unknown`

**Key functional areas:**
- Thread reading and message listing
- AI-powered reply classification (OpenAI)
- Draft creation and sending
- Gmail conversation record management in `gmail_conversations`

---

### `server/services/domain-outreach-service.ts`

Unified AI draft generator for **all non-athlete business communication domains**. Every generated draft flows into `gmail_agent_actions` → AI Comms Center → learning loop.

**Supported domains with their configured agents:**

| Domain Key | Agent Name | Risk Level |
|------------|------------|------------|
| `athletic_director` | `athletic_director_outreach_agent` | low |
| `school_partnership` | `school_partnership_outreach_agent` | low |
| `team_training` | `team_training_outreach_agent` | low |
| `coach_outreach` | `coach_outreach_agent` | low |
| `corporate_wellness` | `corporate_wellness_outreach_agent` | medium |
| `facility_partnership` | `facility_partnership_outreach_agent` | low |
| `gym_owner` | `gym_owner_outreach_agent` | low |
| `employment_opportunity` | `employment_outreach_agent` | low |
| `business_outreach` | `business_outreach_agent` | medium |
| `parent_lead` | `parent_outreach_agent` | low |
| `organization_outreach` | `organization_outreach_agent` | low |
| `athlete_lead` | `athlete_lead_outreach_agent` | low |

**Each domain defines** per-message-type configs (`goal`, `tone`, `system prompt`) for message types like `initial_outreach`, `followup_7d`, `meeting_request`, `proposal_followup`, `relationship_nurture`.

---

## 6. Email Agent Sub-System (`server/email-agent/`)

A dedicated layer of 12 modules that handle **team-training prospect outreach intelligence**. These modules are distinct from `server/services/` and operate on `team_training_prospects`, `team_training_deals`, and related tables.

### `scheduled-email-agent.ts`

Daily email agent that runs all team-training outreach for an org.

| Function | Description |
|----------|-------------|
| `runEmailAgentForOrg(orgId, triggerSource)` | Runs full outreach cycle — triggered at 8:30am or manually |
| `initializeScheduledEmailAgent()` | Registers the daily cron |

**Trigger sources:** `cron_8_30am` | `user_click` | `api_call`

---

### `auto-execution-engine.ts`

Selects high-confidence approved email drafts and auto-executes them (sends without human intervention), subject to all policy guards.

| Function | Description |
|----------|-------------|
| `runAutoExecution(orgId)` | Evaluates and executes all auto-eligible actions |
| `undoAutoExecution(orgId, actionId)` | Reverses a recent auto-execution |
| `getExecutionLog(orgId)` | Returns recent auto-execution records |
| `recordAutoExecEngagement(orgId, prospectId)` | Records engagement outcome |
| `recordAutoExecRevenue(orgId, prospectId, value)` | Records revenue outcome |
| `getAutoExecPerformanceMetrics()` | Returns performance KPIs |
| `buildAutoExecContextString()` | Formats context for AI prompt |

---

### `follow-up-cron.ts`

Manages adaptive follow-up scheduling for team-training prospects.

| Function | Description |
|----------|-------------|
| `computeAdaptiveFollowUpDays(params)` | Computes optimal follow-up delay based on contact quality, stage, prior attempts |
| `scheduleFollowUpsForDraft(draft, orgId)` | Creates follow-up records for a sent draft |
| `processFollowUpsForOrg(orgId)` | Cron tick — processes due follow-ups for an org |
| `initializeFollowUpCron()` | Registers the cron |

---

### `global-priority-engine.ts`

Ranks all pending AI actions into a single priority queue for the CEO Heartbeat to consume.

| Function | Description |
|----------|-------------|
| `buildGlobalActionQueue(orgId)` | Returns `GlobalPriorityQueue` — all pending actions ranked by priority score |
| `buildGlobalPriorityContextString(queue)` | Formats the queue for AI prompt injection |

---

### `reply-classifier.ts`

Classifies inbound prospect replies using OpenAI.

| Function | Description |
|----------|-------------|
| `classifyReply(replyText)` | Returns `ReplyClassification` (interested/objection/unsubscribe/etc.) |
| `classificationLabel(c)` | Human-readable label for a classification |
| `classificationColor(c)` | Tailwind CSS color class for a classification |

---

### `audit-engine.ts`

Health audit for the entire email agent system.

| Function | Description |
|----------|-------------|
| `runEmailAgentAudit(orgId)` | Returns `AuditReport` — checks all components for health issues |

---

### `revenue-outcome-engine.ts`

Ties every AI action to real revenue outcomes via `ai_revenue_events` for multi-touch attribution.

| Function | Description |
|----------|-------------|
| `logActionAsEvent(opts)` | Creates an `ai_revenue_events` row when an action is executed |
| `logMultiTouchAttributionChain(opts)` | Records all contributors to a revenue event |
| `attributeOutcomeToProspect(orgId, prospectId, value)` | Attributes revenue to a prospect's email chain |
| `getRevenueOutcomes(orgId)` | Returns all revenue outcomes for an org |
| `buildRevenueContextString(outcomes)` | Formats for AI prompt injection |

> **Column name:** `ai_revenue_events` uses `outcome_value` (integer cents), not `amount`.

---

### `trigger-logger.ts`

Logs every email trigger decision — the "why did the email send?" audit trail.

| Function | Description |
|----------|-------------|
| `logTriggerEvent(input)` | Writes to `email_trigger_events` |
| `updateTriggerEvent(id, update)` | Updates result after send attempt |
| `detectTriggerCollision(orgId, prospectId)` | Returns true if same prospect was triggered within dedup window |
| `buildTriggerContextForProspect(orgId, prospectId)` | Formats recent trigger history for AI context |
| `logMissedOpportunity(input, reason)` | Records why an eligible trigger was blocked |

---

### `trigger-alerts.ts`

Proactive system warnings about email agent health.

| Function | Description |
|----------|-------------|
| `computeTriggerAlerts(orgId)` | Returns `TriggerAlertsResult` — warnings about trigger problems |
| `buildTriggerAlertsContextString(result)` | Formats alerts for AI prompt injection |

---

### `contextual-intelligence.ts`

Builds rich context objects for prospect outreach decisions.

| Function | Description |
|----------|-------------|
| `buildProspectContext(prospectId, orgId)` | Returns full `ProspectContext` — prospect data, deal stage, conversation history, contact quality |
| `getNextBestAction(params)` | Returns the recommended next action for a prospect |
| `getIntelligenceOverview(orgId)` | Returns org-level intelligence summary for admin dashboard |
| `getDealIntelligence(deal, prospect)` | Returns deal-level intelligence signals |

---

### `conversation-stage.ts`

Classifies the current conversation stage for a prospect. Pure computation — no DB writes.

**Stages:** `no_contact`, `first_outreach`, `follow_up`, `engaged`, `meeting_booked`, `proposal`, `negotiation`, `closed_won`, `closed_lost`, `dormant`

| Function | Description |
|----------|-------------|
| `computeConversationStage(params)` | Returns `ConversationStage` |
| `getStageInfo(stage)` | Returns `StageInfo` (label, description, recommended actions) |
| `getStageSendingBlocked(stage)` | Returns true if sending is blocked at this stage |
| `getStageMessageingGuidance(stage)` | Returns guidance string for this stage |

---

### `contact-quality.ts`

Scores the quality of a prospect's contact information.

**Tiers (highest to lowest):** `decision_maker` → `role_based` → `general` → `missing`

| Function | Description |
|----------|-------------|
| `computeContactQualityScore(prospect)` | Returns `ContactQuality` with tier and score |
| `contactQualityBadgeClass(tier)` | Tailwind CSS badge class |
| `contactQualityLabel(tier)` | Human-readable label |

---

## 7. Message Learning & Outcome Intelligence

### `server/services/message-learning-service.ts`

Converts human feedback on AI-generated emails into durable learning rules, and provides learning context for future AI generation. Domain-aware — each `communication_domain` has its own rule set.

**Communication domains (12):**

```
athlete_lead, parent_lead, team_training, school_partnership,
athletic_director, coach_outreach, organization_outreach,
business_outreach, employment_opportunity, corporate_wellness,
facility_partnership, gym_owner
```

**Learning rule types:** `do` | `avoid` | `tone` | `cta` | `length` | `personalization` | `lead_stage`

**Key exports:**

| Function | Description |
|----------|-------------|
| `inferCommunicationDomain(row)` | Infers domain from row fields (communicationDomain, dealId, actionType) |
| `extractPreferencesFromFeedback(feedback)` | Calls OpenAI to extract preference rules from human edits |
| `upsertLearningRules(orgId, domain, rules[])` | Writes rules to `agent_message_learning_rules` |
| `getLearningContextForGeneration(orgId, domain)` | Returns learning rules formatted for AI prompt injection |
| `applyFeedbackToLearning(feedbackId)` | Marks a feedback record's rules as applied |

**Tables written:** `agent_message_learning_rules`, `agent_message_feedback` (reads), `agent_message_revisions`

---

### `server/services/outcome-intelligence-service.ts`

Tracks real-world outcomes for every sent AI communication, scores rule effectiveness by outcomes, and powers outcome-weighted learning context injection.

**Outcome statuses (ordered pipeline):**

```
sent → opened → replied → meeting_booked → proposal_requested →
proposal_sent → proposal_accepted → contract_signed →
hired / booked_session / converted → lost / bounced / ignored
```

**Key exports:**

| Function | Description |
|----------|-------------|
| `createOutcomeOnSend(opts)` | Creates `agent_communication_outcomes` row on send |
| `updateOutcomeStatus(id, status, timestamp?)` | Advances the outcome pipeline |
| `getOutcomesForOrg(orgId, domain?)` | Returns all outcomes for an org |
| `scoreRuleEffectiveness(orgId, domain?)` | Computes per-rule effectiveness scores |
| `getTopEffectiveRules(orgId, domain?)` | Returns highest-performing rules |
| `buildOutcomeContextString(orgId, domain?)` | Formats for AI prompt injection |

**Tables written:** `agent_communication_outcomes`, `agent_rule_effectiveness`

> **Wired into:** Single-approve path, bulk-approve path in `agentmail-reply-routes.ts`.

---

### `server/services/agent-outcome-attribution-service.ts`

Tracks per-agent decision outcomes and computes performance scores used in CEO Reviews and Playbook generation.

**Agent types tracked:** 12 types including `email_agent`, `growth_agent`, `retention_agent`, `scheduling_agent`, `client_success_agent`, `revenue_agent`

**Key exports:**

| Function | Description |
|----------|-------------|
| `logDecisionOutcome(opts)` | Records an agent decision and initial outcome |
| `updateDecisionOutcome(opts)` | Updates outcome after result is known |
| `recalculatePerfScores(orgId)` | Recomputes performance scores from raw outcome data |
| `getAgentPerfScores(orgId)` | Returns scores per agent type |
| `getDecisionEffectiveness(orgId)` | Returns per-decision effectiveness analysis |
| `searchSimilarDecisions(opts)` | Finds similar past decisions for context |
| `generateCEOReview(orgId)` | AI-generates a CEO-level agent performance review |
| `saveCEOReview(orgId, review)` | Persists the CEO review |
| `getCEOReviews(orgId, limit)` | Returns recent CEO reviews |
| `getPlaybookCandidates(orgId)` | Identifies decisions ready to be promoted to playbooks |
| `promoteToPlaybook(orgId, opts)` | Saves a decision as a reusable playbook |
| `getPlaybooks(orgId)` | Returns all saved playbooks |
| `getRecentOutcomes(orgId, limit)` | Returns recent outcomes for review |
| `getBusinessFlywheel(orgId)` | Returns the business flywheel view |

---

## 8. Athlete Intelligence Services

### `server/services/athlete-context-broker.ts`

The **central hub for all athlete intelligence**. Builds, maintains, and serves the `athlete_context_objects` living intelligence summary for every active athlete. This object is the primary context injected into all AI-generated workout programs and adaptation proposals.

**Refresh triggers:** `manual`, `cron`, `session_completed`, `readiness_check_in`, `intervention_applied`, `pr_added`, `daily_refresh`

**Staleness threshold:** 12 hours — contexts older than this are automatically refreshed on next access.

**Risk classification logic:**

| Condition | Risk Level |
|-----------|------------|
| `compliance_rate < 40%` | `red` |
| `readiness_trend = "low"` | `red` |
| `rpe_avg ≥ 9` | `red` |
| `compliance_rate < 65%` | `yellow` |
| Otherwise | `green` |

**Key exports:**

| Function | Description |
|----------|-------------|
| `buildAthleteContextObject(athleteUserId, orgId, trigger)` | Builds a fresh context from all source tables |
| `getAthleteContextForAI(athleteUserId, orgId)` | Returns current context (refreshes if stale) |
| `refreshAthleteContextObject(athleteUserId, orgId, trigger)` | Forces a refresh |
| `summarizeAthleteContextForPrompt(context)` | Returns short natural-language summary for AI |
| `buildMemoryEnrichedContextString(athleteUserId, orgId)` | Adds PAIL memory data to context string for workout builder |
| `computeTrainChatModifiers(context)` | Returns `TrainChatModifiers` — volume/intensity adjustments for TrainChat |
| `refreshAllActiveAthleteContexts(orgId)` | Batch refresh for all active athletes |
| `runDailyAthleteContextRefreshCron()` | Daily cron tick |

**Data sources aggregated:** `workout_readiness_checkins`, `workout_completion_logs`, `workout_session_exercise_logs`, `workout_sessions`, `workout_programs`, `pr_lift_entries`, `athlete_risk_flags`, `athlete_intervention_recommendations`, `athlete_memory_profiles`, `exercise_effectiveness_scores`

---

### `server/services/athlete-learning-engine.ts`

PAIL (Persistent Athlete Intelligence Layer) learning engine. Synthesizes session history into long-term athlete memory profiles.

**Key exports:**

| Function | Description |
|----------|-------------|
| `recalculateExerciseEffectiveness(athleteUserId, orgId)` | Recomputes effectiveness scores for all exercises used by an athlete |
| `synthesizeAthleteIntelligence(athleteUserId, orgId)` | AI-synthesizes full memory profile from session history |
| `runAthleteLearningSynthesisForOrg(orgId)` | Runs synthesis for all active athletes in an org |

**Tables written:** `exercise_effectiveness_scores`, `athlete_memory_profiles`, `athlete_session_outcomes`

---

### `server/services/program-adaptation-engine.ts`

Detects context changes that warrant workout program adaptation and generates coach-reviewable adaptation drafts. **Never auto-applies changes.**

**Signals detected:**

| Signal | Severity | Description |
|--------|----------|-------------|
| `readiness_dropped_to_low` | high | Readiness trend fell to low |
| `compliance_below_50_pct` | high | Compliance dropped below 50% |
| `consecutive_missed_sessions` | high | 3+ missed sessions in a row |
| `sustained_high_rpe` | medium | Average RPE ≥ 8.5 sustained |
| `compliance_recovering` | medium | Compliance recovering — opportunity to progress |

**Key exports:**

| Function | Description |
|----------|-------------|
| `detectContextChanges(prev, curr)` | Returns `ContextChangeResult` with signals |
| `checkAndGenerateAdaptationDraft(athleteUserId, orgId, prev, curr)` | Creates `program_adaptation_drafts` row if signals warrant |
| `getAdaptationDraftsForOrg(orgId)` | Returns all pending adaptation drafts |
| `approveAdaptationDraft(draftId, reviewedBy)` | Marks draft as approved |
| `rejectAdaptationDraft(draftId, reviewedBy)` | Marks draft as rejected |

---

### `server/services/daily-operations-engine.ts`

Generates a proactive operations brief for the org every morning. Pushes into `organization_intelligence_state` and fires an event bus event for coach briefing enrichment.

**Brief components:**
- Critical athlete list (red + escalating yellow)
- Unresolved intervention queue (drafted but not approved)
- Predicted churn risks (compliance + engagement signals)
- Coach action priorities (ordered list)
- Recommended org actions
- Recovery bottlenecks
- Staffing / workload concerns

**Key types:** `CriticalAthlete`, `ChurnRiskAthlete`, `OpsActionPriority`, `DailyOpsBrief`

---

## 9. Lead & Intake Pipeline

### `server/services/intelligent-lead-intake-service.ts`

Non-blocking AI pipeline that fires on every lead capture form submission. Runs in the background — the submission endpoint returns immediately.

**Pipeline steps (concurrent where possible):**
1. Normalize and validate intake data
2. AI summary generation (OpenAI)
3. Lead scoring (0–100, temperature, urgency)
4. Initial outreach draft generation (OpenAI)
5. Upsert `lead_intelligence_profiles`
6. Queue Gmail draft action
7. Create follow-up sequence
8. Write processing log

Steps 2 and 4 run concurrently via `Promise.all` for ~3–4s total pipeline time.

**Lead scoring output:** Score (0–100) + temperature (`cold`/`warm`/`hot`) + urgency (`low`/`medium`/`high`) + `suggested_next_action`

**Stage transitions:** Every stage change records `{ fromStage, toStage, reason, source, confidence, timestamp }` in `lead_intelligence_profiles.stage_transitions`.

**Key exports:**

| Function | Description |
|----------|-------------|
| `runIntelligentLeadIntakePipeline(data: RawIntakeData)` | Primary entry point — fires non-blocking |
| `buildStageTransition(from, to, reason, source, confidence)` | Builds a transition record |
| `suppressLead(submissionId, reason)` | Marks a lead as suppressed |

---

### `server/services/lead-recovery-cron.ts`

Recovers stale leads — those that were captured but failed to move through the pipeline (e.g., due to AI failures or processing errors).

**Runs:** Every 15 minutes (configurable)

**Key exports:**

| Function | Description |
|----------|-------------|
| `runLeadRecoveryCron()` | Processes all stale/failed leads for recovery |
| `startLeadRecoveryCron(intervalMs?)` | Starts the cron (default: 15 min) |
| `stopLeadRecoveryCron()` | Stops the cron |

---

## 10. AI Memory: Obsidian & Hermes

### `server/services/obsidian-service.ts`

Integration with an external Obsidian vault (via Obsidian REST API). Used as the long-term human-readable memory store for agents.

**Configured via:** `OBSIDIAN_BASE_URL` env var (must have trailing slash stripped). Raw spaces (not `%20`) are used in folder paths.

**Vault folder structure** (`OBSIDIAN_FOLDERS`): `heartbeat`, `decisions`, `software`, `hermes`, `outcomes`, `playbooks`, `ceo_reviews`, `knowledge_base`

**Core CRUD:**

| Function | Description |
|----------|-------------|
| `isObsidianConfigured()` | Returns true if `OBSIDIAN_BASE_URL` is set |
| `createNote(folder, title, content, meta?)` | Creates a vault note |
| `updateNote(folder, title, content, meta?)` | Updates an existing note |
| `appendToNote(folder, title, content)` | Appends to a note |
| `readNote(folder, title)` | Reads note content |
| `searchNotes(query, folder?)` | Full-text vault search |
| `listVaultFiles()` | Lists all vault files (recursive) |
| `findSimilarNotes(content, folder?)` | Similarity search |
| `retrieveAgentContext(agentName, orgId)` | Fetches relevant context for an agent |
| `getVaultStats()` | Returns vault statistics |
| `checkConnection()` | Health check |
| `probeEndpoints()` | Detailed endpoint probe report |

**Domain-specific writers (all write to Obsidian + optionally DB):**

| Function | Vault Folder |
|----------|-------------|
| `writeHeartbeatReport(opts)` | `heartbeat/` |
| `writeAgentDecision(opts)` | `decisions/` |
| `writeSoftwareImprovement(opts)` | `software/` |
| `writeHermesLearning(opts)` | `hermes/` |
| `recordOutcomeLearning(opts)` | `outcomes/` |
| `writeDecisionJournal(opts)` | `decisions/` |
| `writeSoftwareKB(opts)` | `knowledge_base/` |
| `writeCEOReview(opts)` | `ceo_reviews/` |
| `writePlaybook(opts)` | `playbooks/` |

---

### `server/services/obsidian-sync-service.ts`

Queue-based async sync to Obsidian. Callers enqueue a sync item; a cron processes the queue. This prevents blocking on Obsidian latency in hot paths.

**Key exports:**

| Function | Description |
|----------|-------------|
| `queueObsidianSync(item)` | Adds an item to the sync queue |
| `trySyncNow(item)` | Attempts immediate sync (bypasses queue) |
| `processObsidianSyncQueue()` | Processes all pending queue items |
| `startObsidianSyncCron()` | Starts the queue processor cron |
| `getQueueStats()` | Returns queue depth and failure counts |
| `getQueueItems(opts)` | Returns queue items with filters |
| `requeueFailed()` | Requeues all failed items for retry |

---

### `server/services/hermes-service.ts`

Minimal orchestration layer bridging system outcome events to Obsidian learning notes. Every event also writes to `agent_operating_timeline` — the timeline write succeeds even if Obsidian is down.

**Hermes event sources:**
- `software_improvement_task_created`
- `communication_outcome_recorded`

**Design:** Hermes never throws if Obsidian is unavailable. Returns structured `HermesResult` with `obsidianConfigured`, `timelineId`, and `success` flag.

**Key export:**

| Function | Description |
|----------|-------------|
| `processOutcomeEvent(source, payload)` | Single entry point for all Hermes learning writes |

---

### `server/services/hermes-learning-service.ts`

Phase 2 learning engine. True deduplication and confidence reinforcement.

**Raw SQL table managed:** `hermes_auto_learnings` (created via `ensureHermesLearningsTable()`)

**Phase 2 deduplication:** Upsert on `content_hash`. Same domain + source + learning text maps to one row — duplicates reinforce `confidence_score` and `occurrence_count` instead of cloning.

**State-change capture:** Heartbeat captures hash the health state signature — `healthy→healthy` deduplicates (increments), `healthy↔error` creates a new row.

**Key exports:**

| Function | Description |
|----------|-------------|
| `ensureHermesLearningsTable()` | Idempotent table creation |
| `captureHermesLearning(opts)` | Writes or reinforces a learning entry |
| `getTopLearningsForContext(orgId, domain?, limit?)` | Returns top learnings weighted by `confidence × ln(occurrence_count)` |
| `recordLearningRetrieval(id)` | Increments `retrieved_count` and updates `last_retrieved_at` |

**Injected into:** CEO Heartbeat priorities, Recommendation Engine context, Executive Agent brief.

---

### `server/services/hermes-recommendation-engine.ts`

Sprint 2: Promotes Hermes from passive learning to active intelligence participant. Evaluates live signals → generates structured recommendations → queues items in `autonomous_action_queue` for human review.

**Confidence threshold for queue entry:** 0.70

**Raw SQL tables managed:** `hermes_recommendations`, `autonomous_action_queue`

**Design principle:** Never auto-executes. Every recommendation requires human approval. Full cross-system traceability: `hermes_recommendations.id` → `autonomous_action_queue.source_action_id`.

**Key exports:**

| Function | Description |
|----------|-------------|
| `ensureHermesTables()` | Idempotent table creation for both tables |
| `runHermesIntelligenceCycle(orgId)` | Evaluates signals and generates recommendations |
| `getHermesStats(orgId)` | Returns Hermes performance statistics |
| `getHermesHealth(orgId)` | Returns system health status |

---

## 11. Forecasting & Digital Twin

### `server/services/forecast-engine.ts`

Business forecasting, risk detection, opportunity discovery, scenario simulation, and strategic planning. All tables created via raw SQL (`createForecastTables()`).

**Raw SQL tables managed:** `business_forecasts`, `risk_signals`, `opportunity_signals`, `scenario_simulations`, `strategic_plans`, `forecast_accuracy`, `business_twin_state`

**Business OS Score:** Composite score from 7 inputs: financial health, athlete retention, lead velocity, workflow execution, autonomy trust, coach capacity, strategic alignment.

**Key exports:**

| Function | Description |
|----------|-------------|
| `createForecastTables()` | Idempotent table creation |
| `refreshDigitalTwin(orgId)` | Rebuilds the digital twin state from live data |
| `getDigitalTwin(orgId)` | Returns current twin state |
| `generateForecasts(orgId)` | AI-generates business forecasts |
| `getForecasts(orgId)` | Returns saved forecasts |
| `detectRisks(orgId)` | Detects and writes risk signals |
| `getRisks(orgId)` | Returns current risk signals |
| `detectOpportunities(orgId)` | Detects and writes opportunity signals |
| `getOpportunities(orgId)` | Returns current opportunities |
| `runScenarioSimulation(orgId, opts)` | Runs a what-if simulation |
| `getSimulations(orgId)` | Returns saved simulations |
| `generateStrategicPlan(orgId, horizonDays)` | AI-generates a strategic plan |
| `getStrategicPlans(orgId)` | Returns saved strategic plans |
| `recordActualOutcome(orgId, opts)` | Records actual vs. forecast for accuracy tracking |
| `getForecastAccuracy(orgId)` | Returns accuracy metrics |
| `getBusinessOSScore(orgId)` | Returns composite 7-component Business OS score |
| `getForecastDashboard(orgId)` | Returns all forecast data for the dashboard |

> **Important:** `orgAiRisks` does NOT exist — use `risk_signals` table from this service (raw SQL).

---

## 12. CEO Heartbeat & Agent Orchestration

### `server/services/ceo-heartbeat-service.ts`

The central orchestration service. Runs every 30 minutes, coordinates all agents, evaluates priorities, and manages distributed job locks. 1,194 lines.

**In-memory state:**

| Variable | Type | Description |
|----------|------|-------------|
| `_heartbeatInterval` | `setInterval` handle | Active cron interval |
| `_lastRunAt` | `Date \| null` | Last successful run timestamp |
| `_nextRunAt` | `Date \| null` | Seeded from DB on startup |
| `_currentRunId` | `string \| null` | Active heartbeat run ID |
| `_globalPaused` | `boolean` | Pause sentinel (persisted in `job_execution_locks`) |

**Cron interval:** 30 minutes (`HEARTBEAT_INTERVAL_MS = 30 * 60 * 1000`)

**Key exports grouped:**

**Timeline:**

| Function | Description |
|----------|-------------|
| `writeTimeline(entry)` | Writes to `agent_operating_timeline` — the unified event log |

**Distributed locks:**

| Function | Description |
|----------|-------------|
| `acquireJobLock(lockKey, orgId, jobName, ttlMs)` | Acquires a lock in `job_execution_locks` |
| `releaseJobLock(lockKey)` | **Deletes** the lock row (not updates to "released") |
| `buildIdempotencyKey(opts)` | Constructs a deterministic key for dedup |
| `checkIdempotency(key)` | Returns true if a key has already been processed |

> **Critical:** `releaseJobLock()` deletes the row. Updating to "released" blocks future runs within the 28-min window. The startup cleanup deletes lingering "acquired" rows.

**Heartbeat lifecycle:**

| Function | Description |
|----------|-------------|
| `runHeartbeatCycle(opts)` | Runs a single full orchestration cycle |
| `runHeartbeatForAllOrgs(triggeredBy?)` | Runs for every active org |
| `startCeoHeartbeat()` | Starts the 30-min interval |
| `pauseCeoHeartbeat()` | Pauses the interval |
| `resumeCeoHeartbeat()` | Resumes the interval |
| `getHeartbeatStatus()` | Returns `HeartbeatStatus` |
| `getExecutionHealth(orgId)` | Returns `ExecutionHealth` |

**Other:**

| Function | Description |
|----------|-------------|
| `runLedgerDriftCheck(orgId)` | Detects financial ledger drift (runs as step 8 of `coordinateAgents`) |

**Heartbeat cycle steps** (from `runHeartbeatCycle`): The cycle coordinates agents in sequence, aggregates their outputs, computes a priority queue via `buildGlobalActionQueue()`, and triggers high-confidence auto-executions.

---

## 13. Agent Quality & Safety Infrastructure

### `server/services/agent-quality-service.ts`

Computes per-agent trust scores across 7/30/90-day rolling windows from feedback, approval, rejection, edit-before-send, failure, and learning conversion data.

**Trust tiers:** `training` → `assisted` → `trusted` → `high_trust` → `restricted`

**Tier computation thresholds:**

| Tier | Minimum Quality Score |
|------|-----------------------|
| `high_trust` | ≥ 75 |
| `trusted` | ≥ 55 |
| `assisted` | ≥ 35 |
| `training` | < 35 or < 5 total actions |
| `restricted` | Any rejection spike |

**Minimum actions for tier computation:** 5 (returns `training` below threshold)

**Note:** `communication_domain` defaults to `'all'` (not NULL) to satisfy the UNIQUE index on `(org_id, agent_name, communication_domain, window_days)`.

---

### `server/services/integration-status-service.ts`

Aggregates the effective status of all integrations from two sources: DB (`external_integrations` table) first, env-var fallback second.

**Infrastructure services** (not shown as "external integrations" in the UI):

```typescript
export const INFRASTRUCTURE_SERVICES = new Set([
  "agentmail", "hermes", "obsidian"
  // etc.
])
```

**Key exports:**

| Function | Description |
|----------|-------------|
| `getEffectiveConnectedIntegrations(orgId)` | Returns `Set<string>` of connected integration types |
| `getIntegrationStatusDetails(orgId)` | Returns detailed status for each integration |

---

### `server/services/agent-dead-letter-service.ts`

Dead-letter queue for failed agent actions that exceeded retry limits.

**Key exports:**

| Function | Description |
|----------|-------------|
| `pushToDeadLetter(opts)` | Writes a failed job to the dead-letter store |
| `getDeadLetterJobs(opts?)` | Returns dead-letter jobs with optional filters |
| `getDeadLetterSummary(orgId?)` | Returns aggregate summary |
| `markJobResolved(jobId)` | Marks a dead-letter job as resolved |
| `incrementRetryCount(jobId)` | Increments the retry counter |

> **Important:** `dead_letter` entries now store `userId` (added during Safety Audit). The `userId` field is required for audit trail completeness.

---

## 14. Notification & Activity Automation

### `server/services/notification-automation.ts`

Event-driven notification system. Receives typed events and dispatches in-app notifications with cooldown enforcement to prevent notification spam.

**Notification event types (20+):**

```
workout_assigned, workout_completed, workout_missed, workout_updated,
readiness_low, high_fatigue, adaptation_recommendation,
pr_added, new_pr, pr_spike, streak_milestone,
new_highlight_found, public_profile_update, recruiting_update,
inactivity_warning, coach_message, team_announcement,
welcome_to_team, athlete_added, trainchat_adjustment_ready
```

**Cooldown windows (in-memory per recipient):**

| Event Type | Cooldown |
|------------|----------|
| `readiness_low` | 4 hours |
| `high_fatigue` | 24 hours |
| `workout_missed` | 24 hours |
| `inactivity_warning` | 48 hours |
| `adaptation_recommendation` | 6 hours |

**Tables written:** `org_notifications`, `notification_automation_logs`

---

## 15. Named Agents (`server/agents/`)

These are the platform's highest-level orchestrators. Each agent has a defined scope, runs on a cron, and produces structured outputs into dedicated tables.

### `executive-agent.ts` — Business Brain

The primary multi-system orchestrator. Runs the "business brain" cycle that coordinates all other agents.

| Function | Description |
|----------|-------------|
| `runOrchestrator(orgId, triggeredBy?)` | Runs the full business brain cycle |
| `startBusinessBrainCron()` | Starts the scheduled cron |

**Returns:** `OrchestratorResult` — aggregated output from all coordinated agents.

---

### `apex-agent.ts` — Growth & Opportunity

Generates high-priority growth recommendations from multi-system signals.

| Function | Description |
|----------|-------------|
| `ensureApexRecommendationsTable()` | Idempotent table creation for `apex_recommendations` |
| `runApexForOrg(orgId, triggeredBy?)` | Runs for one org |
| `runApexForAllOrgs(triggeredBy?)` | Runs for all orgs |
| `startApexDailyCron()` | Starts the daily cron |

**Output:** `apex_recommendations` rows with urgency, `estimated_value_cents`, status lifecycle.

**Route registration:** `server/agents/apex-agent-routes.ts` → `registerApexAgentRoutes(app)`.

---

### `growth-agent.ts` — Lead Source Intelligence

Analyzes lead sources and growth signals to optimize outreach.

| Function | Description |
|----------|-------------|
| `computeBestLeadSource(orgId)` | Returns the highest-converting lead source |
| `runGrowthAgent(orgId)` | Full growth analysis cycle |

**Returns:** `GrowthAgentResult`

---

### `pulse-agent.ts` — Pulse Recommendations

Generates daily pulse recommendations — quick-action insights for coaches and admins.

| Function | Description |
|----------|-------------|
| `ensurePulseRecommendationsTable()` | Idempotent table creation |
| `runPulseForOrg(orgId, opts?)` | Runs pulse analysis for one org |
| `runPulseForAllOrgs()` | Runs for all orgs |
| `startPulseDailyCron()` | Starts the daily cron |

**Route registration:** `server/agents/pulse-agent-routes.ts` → `registerPulseAgentRoutes(app)`.

---

### `client-success-agent.ts` — Client Success

Monitors athlete health metrics and generates client success priorities.

| Function | Description |
|----------|-------------|
| `runClientSuccessAgent(orgId)` | Runs client success analysis |

**Returns:** `ClientSuccessAgentResult`

> **Score bug — resolved:** All `priorityScore` and composite score expressions must use `Math.round()`. Float arithmetic (e.g., `×0.3`/`×0.5`) fed directly into integer DB columns caused silent truncation.

---

### `retention-agent.ts` — Retention

Identifies churn risks and generates retention action recommendations.

| Function | Description |
|----------|-------------|
| `runRetentionAgent(orgId)` | Runs retention analysis |

**Returns:** `RetentionAgentResult`

---

### `scheduling-agent.ts` — Scheduling Intelligence

Provides AI-assisted scheduling recommendations and conflict detection.

| Function | Description |
|----------|-------------|
| `runSchedulingAgent(orgId)` | Runs scheduling intelligence analysis |

**Returns:** `SchedulingAgentResult`

---

## 16. Opportunity Acquisition Agents

A group of domain-specialized agents for B2B opportunity discovery (schools, facilities, sponsors, hiring, partnerships). Located in `server/services/` with `opportunity-*` and department-specific prefixes.

### Architecture

Each domain follows the same 5-agent pattern:

```
opportunity-executive-coordinator.ts  ← orchestrates the domain
opportunity-discovery-agent.ts        ← finds prospects
opportunity-outreach-agent.ts         ← generates draft outreach
opportunity-qualification-agent.ts    ← scores and qualifies
opportunity-followup-agent.ts         ← manages follow-up
opportunity-reply-intelligence-agent.ts ← classifies inbound replies
opportunity-reply-monitor.ts          ← polls for new replies
opportunity-outreach-execution-agent.ts ← executes approved outreaches
opportunity-learning-agent.ts         ← learns from outcomes
opportunity-acquisition-orchestrator.ts ← top-level coordinator
```

### Department Agents

| Department | Files |
|------------|-------|
| Hiring | `hiring-department-coordinator.ts`, `hiring-executive-agent.ts`, `hiring-outreach-agent.ts`, `hiring-assessment-agent.ts`, `hiring-learning-agent.ts` |
| Sponsorship | `sponsorship-department-coordinator.ts`, `sponsorship-executive-agent.ts`, `sponsorship-outreach-agent.ts`, `sponsorship-assessment-agent.ts`, `sponsorship-learning-agent.ts` |
| Partnership | `partnership-department-coordinator.ts`, `partnership-executive-agent.ts`, `partnership-outreach-agent.ts`, `partnership-assessment-agent.ts`, `partnership-learning-agent.ts` |

### `opportunity-learning-agent.ts`

| Function | Description |
|----------|-------------|
| `ensureLearningTables()` | Creates raw SQL tables for learning data |
| `recordOutcomeLearningSignal(opts)` | Records a signal from a completed opportunity action |
| `runOpportunityLearningAnalysis(orgId)` | Full learning analysis cycle |

---

## 17. Software Improvement Agent

### `server/services/software-improvement-agent.ts`

Scans system signals (workflow failures, dead letters, trigger audits, agent execution logs) to create Codex-ready engineering tasks.

**Safety contract:** Creates structured task records **only**. Does NOT execute code, deploy, merge PRs, send emails, or touch Stripe.

**Cooldown:** 1 hour between runs per org (in-memory, reset on server restart).

**Signal sources scanned:**
- `workflow_runs` — failed runs
- `email_trigger_events` — trigger failures
- `unified_agent_action_log` — agent errors and failures
- Dead-letter queue

**Key exports:**

| Function | Description |
|----------|-------------|
| `canRunSoftwareImprovementAgent(orgId)` | Returns true if cooldown has elapsed |
| `runSoftwareImprovementAgent(orgId)` | Full scan and task creation cycle |

**Output:** `software_improvement_tasks` rows with full Codex prompt, severity, priority, and lifecycle status.

**Also wired into:** `hermes-service.ts` (`processOutcomeEvent("software_improvement_task_created", ...)`) for Obsidian/Hermes learning capture.

---

## Data Flow Summary

### Outbound Email Flow

```
Agent generates draft
        ↓
gmail_agent_actions row  (status: proposed)
        ↓
Human approves in AI Comms Center
        ↓
send-guard-service.checkHumanApprovedSendGuards()
        ↓
agentmail-service.sendAgentEmail()
        ↓
agentmail-send-guard.checkAgentMailSendPolicy()
        ↓
AgentMail API sends email
        ↓
outcome-intelligence-service.createOutcomeOnSend()
        ↓
email-agent/revenue-outcome-engine.logActionAsEvent()
```

### Automated Outreach Flow

```
follow-up-cron / auto-execution-engine / scheduled-email-agent
        ↓
autonomy-policy-engine.evaluatePolicy()  →  [approval_required → stop]
        ↓
guarded-outbound-email.guardedSend*()
  ├── send-guard-service.checkHumanApprovedSendGuards()
  ├── communication-coordination-service.shouldSuppressCrossChannelSend()
  └── outbound-audit-log.writeOutboundAuditLog()
        ↓
email.ts:sendTeamTrainingOutreachEmail() or sendAgentOutreachEmail()
        ↓
revenue-outcome-engine.logActionAsEvent()
```

### Athlete Intelligence Flow

```
Workout completed / readiness check-in / PR added
        ↓
athlete-context-broker.refreshAthleteContextObject()
        ↓
program-adaptation-engine.checkAndGenerateAdaptationDraft()  [if signals present]
        ↓
notification-automation.triggerNotificationEvent()
        ↓
athlete-learning-engine.synthesizeAthleteIntelligence()  [batch, daily cron]
```

### Lead Intake Flow

```
lead_capture_submissions form POST
        ↓
intelligent-lead-intake-service.runIntelligentLeadIntakePipeline()  [non-blocking]
  ├── AI summary + scoring (OpenAI)
  ├── Outreach draft generation (OpenAI)
  ├── lead_intelligence_profiles upsert
  ├── gmail_agent_actions queue
  └── agentmail-followup-service.createFollowupSequence()
```

---

## Architecture Discrepancies

### 1. `server/email-agent/` Not Documented in CLAUDE.md as Separate Sub-System

CLAUDE.md lists the email-agent files individually in "Where things live" but does not describe the sub-system's 12-module structure or its distinct scope (team-training prospect outreach only). Developers reading CLAUDE.md cannot determine which files handle Gmail vs. team-training vs. AgentMail flows without reading the source.

### 2. `server/financial-metrics.ts` Not in `server/services/`

CLAUDE.md's "Where things live" section does not specifically call out that `financial-metrics.ts` lives directly in `server/`, not in `server/services/`. This makes it hard to discover. It is the most important service in the platform (single source of truth for all revenue) yet sits outside the service directory convention.

### 3. `hermes_auto_learnings` Table Name Differs from Memory Documentation

The memory file records the Hermes learning table as `hermes_learnings`. The actual table created by `hermes-learning-service.ts` is `hermes_auto_learnings`. The `hermes_recommendations` and `autonomous_action_queue` tables are created by `hermes-recommendation-engine.ts`.

### 4. Opportunity Agent Sub-System Not Mentioned in CLAUDE.md

CLAUDE.md mentions "Team Training Prospecting Agent" but does not document the full 3-department × 5-agent pattern (Hiring, Sponsorship, Partnership) in `server/services/`. These represent significant implemented functionality that is invisible from CLAUDE.md.

### 5. Agent Startup Registration

CLAUDE.md does not document which services register background crons and where they are called from. The startup wiring table in this document (Section 1) is not derivable from CLAUDE.md alone.

### 6. `decision_journal_entries` and `software_kb_entries` Not in `shared/schema.ts`

From memory topic files, these tables are created via raw SQL in their respective service files (`decision-journal-service.ts`, `software-kb-service.ts`) and are not in Appendix A of `docs/schema.md`. They should be added to the raw-SQL table inventory.

---

## Recommended CLAUDE.md Updates

1. **Add `server/financial-metrics.ts`** to the "Where things live" section with the note: "Single source of truth for all financial metrics — callers must not compute revenue independently."

2. **Add sub-system description for `server/email-agent/`**: Clarify it is a 12-module layer specifically for team-training prospect outreach intelligence, distinct from the general agent/service layer.

3. **Document the send guard chain**: Add an architecture note describing the layered guard chain (autonomy-policy-engine → send-guard-service → agentmail-send-guard → guarded-outbound-email) and that all automated sends must pass through it.

4. **Document the opportunity agent pattern**: Add brief mention of the 3-department B2B opportunity acquisition agent pattern (Hiring, Sponsorship, Partnership) in `server/services/`.

5. **Correct Hermes table name**: Replace `hermes_learnings` with `hermes_auto_learnings` wherever the learning table is referenced.

6. **Add `decision_journal_entries` and `software_kb_entries`** to the raw-SQL tables inventory (Appendix A of schema.md).

7. **Add cron startup wiring** to the Architecture section: document which services start background processes and where they are called from in `server/index.ts`.

---

## Files Reviewed

| File | Lines | Role |
|------|-------|------|
| `server/financial-metrics.ts` | 472 | Unified financial metrics — full header read |
| `server/email.ts` | ~900 | Core SendGrid delivery — exports scanned |
| `server/services/ceo-heartbeat-service.ts` | 1,194 | CEO heartbeat — header + exports |
| `server/services/agentmail-send-guard.ts` | 129 | AgentMail send guard — full file |
| `server/services/autonomy-policy-engine.ts` | 467 | Policy engine — header + exports |
| `server/services/intelligent-lead-intake-service.ts` | 655 | Lead intake — header + exports |
| `server/services/hermes-service.ts` | 252 | Hermes bridge — header + exports |
| `server/services/hermes-learning-service.ts` | 632 | Learning engine — header + exports |
| `server/services/hermes-recommendation-engine.ts` | 664 | Recommendation engine — header + exports |
| `server/services/athlete-context-broker.ts` | 822 | Context broker — header + exports |
| `server/services/athlete-learning-engine.ts` | — | PAIL learning — exports |
| `server/services/message-learning-service.ts` | 364 | Message learning — header + exports |
| `server/services/gmail-agent-service.ts` | 841 | Gmail service — header + exports |
| `server/services/domain-outreach-service.ts` | 303 | Domain outreach — header + full domain configs |
| `server/services/outcome-intelligence-service.ts` | 387 | Outcome intelligence — header + exports |
| `server/services/software-improvement-agent.ts` | 436 | Software agent — header + exports |
| `server/services/agent-quality-service.ts` | 384 | Quality service — header + exports |
| `server/services/send-guard-service.ts` | 172 | Send guard — header + exports |
| `server/services/guarded-outbound-email.ts` | 241 | Guarded outbound — header + exports |
| `server/services/agentmail-service.ts` | — | AgentMail — exports |
| `server/services/agentmail-inbound-router.ts` | 652 | Inbound router — header + exports |
| `server/services/agentmail-followup-service.ts` | — | Follow-up sequencing — exports |
| `server/services/communication-coordination-service.ts` | — | Cross-channel — exports |
| `server/services/outbound-audit-log.ts` | — | Audit log — exports |
| `server/services/agent-dead-letter-service.ts` | — | Dead-letter — exports |
| `server/services/lead-recovery-cron.ts` | — | Recovery cron — exports |
| `server/services/integration-status-service.ts` | — | Integration status — exports |
| `server/services/obsidian-service.ts` | ~1,300 | Obsidian vault — exports |
| `server/services/obsidian-sync-service.ts` | — | Obsidian sync — exports |
| `server/services/forecast-engine.ts` | — | Forecast engine — exports |
| `server/services/daily-operations-engine.ts` | 416 | Daily ops — header + exports |
| `server/services/program-adaptation-engine.ts` | 346 | Adaptation engine — header + exports |
| `server/services/notification-automation.ts` | 404 | Notifications — header + exports |
| `server/services/agent-outcome-attribution-service.ts` | — | Attribution — exports |
| `server/services/opportunity-learning-agent.ts` | — | Opportunity learning — exports |
| `server/agents/apex-agent.ts` | — | Apex agent — exports |
| `server/agents/executive-agent.ts` | — | Executive agent — exports |
| `server/agents/growth-agent.ts` | — | Growth agent — exports |
| `server/agents/pulse-agent.ts` | — | Pulse agent — exports |
| `server/agents/client-success-agent.ts` | — | Client success — exports |
| `server/agents/retention-agent.ts` | — | Retention agent — exports |
| `server/agents/scheduling-agent.ts` | — | Scheduling agent — exports |
| `server/email-agent/auto-execution-engine.ts` | — | Auto-execution — exports |
| `server/email-agent/follow-up-cron.ts` | — | Follow-up cron — exports |
| `server/email-agent/global-priority-engine.ts` | — | Priority engine — exports |
| `server/email-agent/scheduled-email-agent.ts` | — | Scheduled agent — exports |
| `server/email-agent/reply-classifier.ts` | — | Reply classifier — exports |
| `server/email-agent/audit-engine.ts` | — | Audit engine — exports |
| `server/email-agent/revenue-outcome-engine.ts` | — | Revenue attribution — exports |
| `server/email-agent/trigger-logger.ts` | — | Trigger logger — exports |
| `server/email-agent/trigger-alerts.ts` | — | Trigger alerts — exports |
| `server/email-agent/contextual-intelligence.ts` | — | Contextual intelligence — exports |
| `server/email-agent/conversation-stage.ts` | — | Conversation stage — exports |
| `server/email-agent/contact-quality.ts` | — | Contact quality — exports |
| `docs/schema.md` | 2,874 | Table references |
| `docs/version-2-roadmap.md` | 208 | Generation order reference |
| `.agents/memory/MEMORY.md` + topic files | — | Historical decisions and constraints |

---

## Confidence Assessment

| Area | Confidence | Notes |
|------|------------|-------|
| Service function signatures | **High** | Read directly from exports via grep and file headers |
| Service purpose and scope | **High** | Read from file-level JSDoc comments and first 40–70 lines |
| Guard chain architecture | **High** | Confirmed from 4 overlapping guard service file headers |
| Communication domain list | **High** | Read verbatim from `message-learning-service.ts` |
| Athlete context logic | **High** | Risk classification thresholds and triggers read directly |
| Cron startup wiring | **Medium** | Derived from function names and memory topic files; not verified against `server/index.ts` directly |
| Opportunity agent structure | **Medium** | Directory listing confirmed 15 files; individual file headers not read |
| Inter-service dependency graph | **Medium** | Inferred from import statements visible in headers; full graph not traced |
| Raw SQL table names (Hermes) | **Medium** | `hermes_auto_learnings` confirmed from source; memory file records `hermes_learnings` — discrepancy noted |

**Overall Document Confidence:** High for documented services; Medium for opportunity agents, cron startup wiring, and services where only exports (not headers) were read.
