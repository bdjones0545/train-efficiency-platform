# TrainEfficiency — Communication Systems Architecture Audit
**Date:** June 6, 2026  
**Scope:** All outbound and inbound communication channels — Gmail, AgentMail, SendGrid, crons, agents, workflows, attention inbox  
**Type:** READ-ONLY audit. No code was modified.

---

## Table of Contents
1. [Phase 1 — Discovery: All Communication Entry Points](#phase-1)
2. [Phase 2 — Gmail Ownership & Send Paths](#phase-2)
3. [Phase 3 — AgentMail Ownership & Send Paths](#phase-3)
4. [Phase 4 — SendGrid Usage & Guard Layer](#phase-4)
5. [Phase 5 — Authority Matrix](#phase-5)
6. [Phase 6 — Duplicate Execution Risk Analysis](#phase-6)
7. [Phase 7 — Approval Enforcement Audit](#phase-7)
8. [Phase 8 — Full Communication Flow Diagram](#phase-8)
9. [Phase 9 — Future State Recommendations](#phase-9)
10. [Phase 10 — Executive Summary](#phase-10)

---

## Phase 1 — Discovery: All Communication Entry Points {#phase-1}

### 1.1 Outbound Email Channels (3 Total)

| Channel | Primary File | Mechanism | Auto-Send Capable? |
|---------|-------------|-----------|-------------------|
| **SendGrid** | `server/email.ts` | Replit Connector → SendGrid API | YES (via cron paths) |
| **Gmail OAuth** | `server/services/gmail-agent-service.ts` | User Gmail OAuth token → Gmail API | YES (unconditional) |
| **AgentMail** | `server/services/agentmail-service.ts` | agentmail.to API (6 inboxes) | NO (human-gated) |

### 1.2 Background Processes / Crons (6 Active)

| Process | File | Interval | Channel Used | Auto-Send? |
|---------|------|----------|-------------|------------|
| Scheduled Email Agent | `server/email-agent/scheduled-email-agent.ts` | Daily 8:30 AM | SendGrid | YES (org setting) |
| Follow-Up Cron | `server/email-agent/follow-up-cron.ts` | Hourly | SendGrid | YES (policy gate) |
| Auto-Execution Engine | `server/email-agent/auto-execution-engine.ts` | 5-min poll | SendGrid | YES (policy gate) |
| AgentMail Follow-Up | `server/agentmail-followup-routes.ts` | Every 20 min | AgentMail | NO (approval required) |
| Lead Recovery Cron | `server/services/lead-recovery-cron.ts` | Every 15 min | None (proposals only) | NO |
| Attendance Report Cron | `server/attendance-report-cron.ts` | Scheduled | SendGrid | YES (admin-triggered) |

### 1.3 Human-Triggered Paths

| Path | Trigger | Channel |
|------|---------|---------|
| Booking confirmation | Session booked | SendGrid |
| Session reminder | Time-based (pre-session) | SendGrid |
| Cancellation notice | Session cancelled | SendGrid |
| Reschedule notice | Session rescheduled | SendGrid |
| Recurring confirmation | Recurring set created | SendGrid |
| Coach/athlete welcome | Account created | SendGrid |
| Password reset | Reset requested | SendGrid |
| Admin outreach approval | Human approves draft in UI | SendGrid |
| AgentMail reply approval | Human approves in reply queue | AgentMail |
| AgentMail follow-up approval | Human approves in attention inbox | AgentMail |

### 1.4 Inbound Handling

| Component | File | Function |
|-----------|------|---------|
| AgentMail Inbound Router | `server/services/agentmail-inbound-router.ts` | Classifies emails → downstream records + attention items |
| Gmail Reply Reader | `server/services/gmail-agent-service.ts` | Reads inbox, classifies replies via OpenAI |
| Attention Inbox | `server/attention-engine.ts` + `attentionItems` table | Aggregates all alerts for human review |

### 1.5 In-App Notification System (No Outbound Email)

- **File:** `server/services/notification-automation.ts`
- **Channel:** In-app only (`orgNotifications` table)
- **Events covered:** workout_assigned, workout_completed, workout_missed, readiness_low, high_fatigue, pr_spike, coach_message, team_announcement, etc.
- **Has cooldown windows** to prevent spam (4h to 48h depending on event type)
- **No email is sent by this system** — it is strictly in-app

---

## Phase 2 — Gmail Ownership & Send Paths {#phase-2}

### 2.1 Two Separate Gmail Implementations

#### Layer A — `server/integrations/gmail.ts` (OAuth Runtime Layer)
- Low-level integration layer for Gmail API
- Functions: `listMessages()`, `getMessage()`, `sendMessage()`, `createDraft()`, `modifyLabels()`
- Acts as a thin HTTP wrapper around the Gmail REST API using stored OAuth tokens
- Called exclusively by `gmail-agent-service.ts`
- Does NOT contain any approval logic

#### Layer B — `server/services/gmail-agent-service.ts` (Agent Service Layer)
- High-level business logic layer built on top of Layer A
- Key functions: `gmailSendEmail()`, `gmailCreateDraft()`, `gmailClassifyReply()`, `gmailGetInbox()`, `gmailGetThread()`
- Writes all actions to `gmail_agent_actions` table for audit trail

### 2.2 Critical: gmailSendEmail() Auto-Send Path

```
gmailSendEmail(opts) → gmail.ts:sendMessage() → Gmail API → DELIVERED
```

**Approval flags set by `gmailSendEmail()`:**
```typescript
approvalRequired: false,   // line ~249
status: "executed",        // line ~250
```

**What is missing from this path:**
- No emergency pause check
- No suppression list check
- No daily send cap
- No opt-out check
- No Send Guard middleware
- No human approval gate
- No policy engine evaluation

**Severity: CRITICAL** — This is the highest-risk send path in the entire system.

### 2.3 Safe Gmail Path — gmailCreateDraft()

```
gmailCreateDraft(opts) → gmail.ts:createDraft() → Gmail Drafts (not sent)
```
- Approval flags: `approvalRequired: true` (line ~324)
- Creates a draft in the connected Gmail account — human must manually send
- This path is safe

### 2.4 Gmail Reply Classification (Read-Only, Safe)

```
gmailGetInbox() → gmailGetThread() → gmailClassifyReply() [OpenAI gpt-4o-mini]
→ attentionItems INSERT / leadIntelligenceProfiles UPDATE
```
- Read-only operations on the Gmail inbox
- Uses OpenAI to classify replies (interested/not_interested/question/booked/unsubscribe)
- Updates lead status in DB — no email sent

### 2.5 Gmail as a Channel Summary

| Operation | Auto-Send? | Guards Present? | Risk Level |
|-----------|-----------|----------------|-----------|
| `gmailSendEmail()` | YES | NONE | **CRITICAL** |
| `gmailCreateDraft()` | NO (draft only) | N/A | LOW |
| `gmailGetInbox()` | N/A | N/A | NONE |
| `gmailClassifyReply()` | N/A | N/A | NONE |

### 2.6 Where gmailSendEmail() Is Called

Callers of `gmailSendEmail()` (per grep):
- `server/services/gmail-agent-service.ts` internally (the function itself)
- `server/agent-tools/implementations.ts` — agent tool calls from AI chat
- Any code path that resolves to the `send_email` or `send_gmail` agent tool

---

## Phase 3 — AgentMail Ownership & Send Paths {#phase-3}

### 3.1 Architecture Overview

AgentMail provides 6 dedicated organizational inboxes hosted at agentmail.to:

| Inbox | Purpose | Default Agent |
|-------|---------|--------------|
| `revenue@` | B2B outreach, pricing inquiries, partner leads | Revenue Agent |
| `hiring@` | Employment applications, coach candidates | Hiring / Employment Agent |
| `scheduling@` | Booking requests, reschedules, cancellations | Scheduling Agent |
| `support@` | Bug reports, billing issues, parent questions | Support / Client Success Agent |
| `operations@` | Operational escalations, partner inquiries | Operations Agent |
| `ceo@` | Executive escalations, critical issues | CEO Heartbeat / Operations Agent |

### 3.2 Outbound Send Path

```
Admin approves in UI → POST /api/agentmail/reply-queue/:id/approve
  → SendGuard check (emergency pause + suppression + daily cap)
  → agentmail-service:sendAgentEmail()
  → agentmail.to API → DELIVERED
  → createOutcomeOnSend() [revenue attribution]
  → CEO Heartbeat timeline write
```

**Key finding:** Send Guard IS applied in the AgentMail reply path. This is the only send path where `send-guard-service.ts` is explicitly invoked.

### 3.3 Inbound Processing Path

```
agentmail.to webhook → POST /api/agentmail/inbound
  → processInboundAgentMail()
    1. Idempotency check (provider_message_id dedup)
    2. Deterministic classification (classifyInboundEmail)
    3. AI enhancement (GPT-4o-mini, best-effort)
    4. Persist to agent_mail_inbound_messages
    5. Spam gate: if spam_or_noise → store only, skip routing
    6. createDownstreamRecord() → teamTrainingProspects | employmentApplicants | software_improvement_tasks
    7. addToAttentionInbox() → attentionItems INSERT
    8. createReplyQueueEntry() (IF suggestedReply exists) → pending human approval
    9. notifyCeoHeartbeat() → agent_operating_timeline
```

**No auto-send in inbound path.** All reply drafts enter the reply queue with pending approval status.

### 3.4 Follow-Up Sequencing

```
agentmail-followup-service: processDueFollowups()
  → finds scheduled items past scheduled_for
  → moves to pending_review status
  → creates Attention Item
  → waits for human to call sendApprovedFollowup()
```

- Cron interval: every 20 minutes (`startFollowupCron()`)
- Items are NEVER auto-sent — they require explicit human approval via `/api/agentmail/followups/:id/approve`
- Sequence created by `createFollowupSequence()` which is wired into the agentmail reply send path

### 3.5 AgentMail System Safety Rating

**SAFE** — AgentMail is the most well-designed channel in the system. Every outbound send requires explicit human approval. The Send Guard is correctly placed. Inbound classification is idempotent.

---

## Phase 4 — SendGrid Usage & Guard Layer {#phase-4}

### 4.1 Central Send Function

All SendGrid sends flow through a single function in `server/email.ts`:

```typescript
async function sendEmail(to, subject, html, fromName?, logCtx?, replyTo?)
```

### 4.2 Guard Checks Inside sendEmail()

The following guards are checked **in order** inside `sendEmail()` before any API call:

| # | Guard | Location | Effect on Failure |
|---|-------|---------|------------------|
| 1 | Emergency Pause | `orgAiGovernanceSettings.emergencyPauseEnabled` | Logs "paused", returns without sending |
| 2 | 15-minute Dedup Cache | `_dedupCache` Map (in-memory) | Logs "deduped", returns without sending |
| 3 | User Opt-Out | `storage.getUserNotificationPreference()` | Logs "user_opt_out", returns without sending |
| 4 | Prospect Opt-Out | `storage.isProspectOptedOut()` | Logs "opt_out", returns without sending |

**Important:** These guards apply to ALL SendGrid sends regardless of origination path (cron, human, admin).

### 4.3 Complete Inventory of SendGrid Email Functions

| Function | Trigger Type | Recipients |
|----------|-------------|-----------|
| `sendBookingConfirmationEmail()` | Transactional | Client |
| `sendBookingConfirmationEmailToCoach()` | Transactional | Coach |
| `sendCoachWelcomeEmail()` | Transactional | Coach |
| `sendCashOutRequestNotification()` | Transactional | Admin |
| `sendUpcomingSessionReminderEmailToClient()` | Transactional | Client |
| `sendUpcomingSessionReminderEmailToCoach()` | Transactional | Coach |
| `sendBookingCancellationEmailToClient()` | Transactional | Client |
| `sendBookingCancellationEmailToCoach()` | Transactional | Coach |
| `sendBookingRescheduleEmailToClient()` | Transactional | Client |
| `sendBookingRescheduleEmailToCoach()` | Transactional | Coach |
| `sendRecurringSessionsCreatedEmailToClient()` | Transactional | Client |
| `sendRecurringSessionsCreatedEmailToCoach()` | Transactional | Coach |
| `sendAgentOutreachEmail()` | Agent outreach | Prospect/Client |
| `sendTeamTrainingOutreachEmail()` | Agent outreach | B2B Prospect |
| `sendPasswordResetEmail()` | Transactional | Any user |
| `sendOrgAthleteWelcomeEmail()` | Transactional | Athlete |
| `sendOrgTeamCoachWelcomeEmail()` | Transactional | Coach |

### 4.4 Special Behaviors

- **Email tracking:** `sendTeamTrainingOutreachEmail()` injects a 1×1 pixel at `/api/email-agent/track-open/:emailId` and rewrites links through `/api/email-agent/track-click/:emailId?url=`
- **Recurring suppression:** After `sendRecurringSessionsCreatedEmailToClient()`, `suppressBookingConfirmation(email)` is called to prevent double-send
- **Password reset bypass:** `sendPasswordResetEmail()` does NOT pass `logCtx` or `org` branding — it bypasses org customization and some guard paths
- **Dedup key format:** `{email}:{type}` — 15-minute TTL in-memory cache

### 4.5 Daily Cap — Location Gap

The `dailyLimit` cap is enforced in:
- `scheduled-email-agent.ts` — checks `currentOverview.sentToday >= dailyLimit`
- `follow-up-cron.ts` — references to daily cap logic
- `auto-execution-engine.ts` — has its own daily cap evaluation

**Gap:** The daily cap is NOT centrally enforced inside `sendEmail()` itself — each caller must implement it independently. This means a new send path added in the future could bypass daily limits.

---

## Phase 5 — Authority Matrix {#phase-5}

### 5.1 Who Can Send What

| Actor | Channel | Send Type | Approval Required? | Guards Applied? |
|-------|---------|-----------|-------------------|----------------|
| **Human Admin (UI)** | SendGrid | Transactional | N/A (direct action) | SendGrid guards |
| **Human Admin (UI)** | AgentMail | Agent reply | Manual approval = the act | Send Guard |
| **Scheduled Email Agent** | SendGrid | B2B outreach | Only if `autoSend=false` | SendGrid guards + daily cap |
| **Follow-Up Cron** | SendGrid | B2B follow-up | Only if policy says `approval_required` | SendGrid guards + daily cap |
| **Auto-Execution Engine** | SendGrid | B2B follow-up | Only if policy says `approval_required` | SendGrid guards |
| **Gmail Agent Service** | Gmail API | Any outreach | **NEVER** | **NONE** |
| **Lead Recovery Cron** | None | Proposal only | Always (never sends) | N/A |
| **AgentMail Follow-Up** | AgentMail | Agent follow-up | Always | Send Guard |
| **Agent Action Executor** | Queue only | Proposal only | Always deferred | N/A |
| **Attendance Cron** | SendGrid | Report email | Admin-configured | SendGrid guards |
| **CEO Heartbeat** | None (writes timeline) | No emails sent | N/A | N/A |
| **Notification Automation** | In-app only | No emails sent | N/A | N/A |

### 5.2 Policy Engine Authority

The Autonomy Policy Engine (`server/services/autonomy-policy-engine.ts`) runs 11 checks and returns one of:
- `approval_required` — queues for human approval
- `auto_execute` — proceeds with automatic send
- `block` — hard stop, no send

**Who uses it:**
- `follow-up-cron.ts` ✅ evaluates policy before every send
- `auto-execution-engine.ts` ✅ evaluates policy before every send
- `scheduled-email-agent.ts` ❌ does NOT call policy engine (uses only `org.autoSend` setting)
- `gmail-agent-service.ts::gmailSendEmail()` ❌ does NOT call policy engine

### 5.3 Org-Level Settings That Control Auto-Send

| Setting | Location | Affects |
|---------|---------|--------|
| `autoSend` | `emailAgentSettings` | scheduled-email-agent (initial outreach) |
| `autoGenerateDrafts` | `emailAgentSettings` | scheduled-email-agent (draft creation) |
| `dailyLimit` | `emailAgentSettings` | scheduled-email-agent (capped at 10) |
| `emergencyPauseEnabled` | `orgAiGovernanceSettings` | All SendGrid sends |
| `maxAutoExecutionsPerDay` | Autonomy policy | follow-up-cron + auto-execution-engine |
| `autoExecutionEnabled` | Autonomy policy | follow-up-cron + auto-execution-engine |

---

## Phase 6 — Duplicate Execution Risk Analysis {#phase-6}

### 6.1 Primary Duplicate Risk: Follow-Up Double-Send

Two independent processes read and act on the `outreach_follow_ups` / `follow_ups` table:

**Process A — Follow-Up Cron** (`follow-up-cron.ts`)
- Interval: hourly
- Reads: pending follow-ups past `scheduled_at`
- On `auto_execute`: calls `sendTeamTrainingOutreachEmail()` → marks `status = "sent"`
- On `approval_required`: creates a `gmail_agent_actions` proposal

**Process B — Auto-Execution Engine** (`auto-execution-engine.ts`)
- Interval: 5 minutes
- Reads: follow-ups via `storage` layer
- On policy approval: calls `sendTeamTrainingOutreachEmail()` → marks `status = "sent"`

**The race condition:**
```
T+0:00  Follow-Up Cron reads item X (status = "pending")
T+0:01  Auto-Execution Engine reads item X (status = "pending" — not yet updated)
T+0:02  Follow-Up Cron sends email to prospect@example.com, marks X = "sent"
T+0:03  Auto-Execution Engine sends SECOND email to prospect@example.com, marks X = "sent"
```

**Severity: HIGH** — Prospect receives duplicate outreach emails. The follow-up itself checks `status === "sent"` but the check is not atomic (no row-level lock).

### 6.2 Secondary Duplicate Risk: Scheduled Agent + Follow-Up Cron

**Process C — Scheduled Email Agent** (`scheduled-email-agent.ts`)
- After sending initial outreach, it calls `scheduleFollowUpsForDraft(orgId, draftId, prospectId, sentAt)`
- This creates follow-up records that are then picked up by both Process A and Process B above

If the Scheduled Email Agent runs twice for the same org on the same day (e.g., settings `_lastRunDate` comparison fails), it could create duplicate follow-up sequences.

**Severity: MEDIUM** — Protected by `_lastRunDate === today` check, but this is in-memory-adjacent (stored setting, not a DB-level lock).

### 6.3 Third Duplicate: AgentMail vs. Gmail Outreach to Same Prospect

- AgentMail sends outreach from `revenue@` inbox
- Gmail Agent sends outreach from the coach's personal Gmail
- No cross-channel dedup exists between these two systems
- A prospect could receive emails from both channels simultaneously with no coordination

**Severity: MEDIUM** — User experience and compliance risk.

### 6.4 Dedup Mechanisms In Place

| Mechanism | Scope | Covers |
|-----------|-------|--------|
| SendGrid 15-min dedup cache | Per email+type | Prevents immediate re-send of same email type |
| Follow-up `status = "sent"` check | Per follow-up record | Partial protection (not atomic) |
| AgentMail inbound `provider_message_id` dedup | Per inbound message | Safe — idempotent inbound |
| Lead Recovery Cron duplicate check | Per lead+draft type | Checks for existing proposed action |
| `dailyJobRunning` flag | Per server instance | Prevents scheduled agent double-start |
| `cronRunning` flag | Per server instance | Prevents lead recovery cron overlap |

**What is missing:** A database-level advisory lock or row-level `SELECT FOR UPDATE` on follow-up items to prevent the Process A + Process B race condition.

---

## Phase 7 — Approval Enforcement Audit {#phase-7}

### 7.1 Per-Path Approval Status

| Send Path | Approval Enforced? | Mechanism | Send Guard Applied? |
|-----------|-------------------|-----------|--------------------|
| AgentMail Reply Queue | ✅ YES — always | Human approves in UI → endpoint | ✅ YES |
| AgentMail Follow-Up | ✅ YES — always | `sendApprovedFollowup()` called only after approval | ✅ YES |
| Lead Recovery Cron | ✅ YES — always | Status `proposed`, `approvalRequired: true` | N/A (no send) |
| Agent Action Executor | ✅ YES — always | Defers to approval queue, never auto-sends | N/A (no send) |
| Follow-Up Cron | ⚠️ CONDITIONAL | Policy engine: `approval_required` → queued; `auto_execute` → sent | ❌ NO Send Guard |
| Auto-Execution Engine | ⚠️ CONDITIONAL | Policy engine: same decision tree | ❌ NO Send Guard |
| Scheduled Email Agent | ⚠️ CONDITIONAL | `org.autoSend` setting: `false` → queued; `true` → sent | ❌ NO Send Guard (internal daily cap only) |
| Gmail `gmailSendEmail()` | ❌ NEVER | `approvalRequired: false` hardcoded | ❌ NO guards at all |
| Transactional SendGrid | ✅ N/A (system-triggered) | Booking/reminder/cancellation events | ✅ SendGrid guards inside `sendEmail()` |

### 7.2 Send Guard Coverage Gap

`send-guard-service.ts` is only called in the **AgentMail reply approval path**. It is not called by:
- Follow-Up Cron auto-send path
- Auto-Execution Engine auto-send path
- Scheduled Email Agent auto-send path
- Gmail send path

The SendGrid `sendEmail()` function does have its own inline guards (emergency pause, dedup, opt-out) that provide partial protection. However, these are NOT the same as the Send Guard, which additionally enforces:
- Daily cap verification
- Suppression list cross-check
- Organization-level governance check

### 7.3 Approval Flow UX Inventory

| UI Location | What It Approves | Channel |
|-------------|-----------------|---------|
| `/admin/agentmail?tab=reply-queue` | AgentMail reply drafts | AgentMail |
| `/admin/agentmail?tab=followups` | AgentMail follow-up drafts | AgentMail |
| `/admin/ai-approvals` | Gmail Agent proposed actions | Gmail (as draft) |
| `/admin/attention-inbox` | All cross-system attention items | Various |
| `/admin/outreach-queue` | Team training outreach drafts | SendGrid |
| `/admin/email-agent` | Email agent settings + send now | SendGrid |
| `/admin/autonomy-controls` | Policy engine thresholds | All auto-send paths |

---

## Phase 8 — Full Communication Flow Diagram {#phase-8}

```
╔══════════════════════════════════════════════════════════════════════════════╗
║              TrainEfficiency — Communication Systems Architecture            ║
╚══════════════════════════════════════════════════════════════════════════════╝

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 INBOUND FLOWS
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

 External Email                External Email
 (via agentmail.to)            (via Gmail OAuth)
         │                            │
         ▼                            ▼
 agentmail-inbound-router.ts   gmail-agent-service.ts
  │ classify()                  │ gmailGetInbox()
  │ createDownstreamRecord()    │ gmailClassifyReply()
  │ addToAttentionInbox() ──────┤
  │ createReplyQueueEntry()     │ → lead status update
  │ notifyCeoHeartbeat()        │ → attentionItems
  │                             │
  ▼                             ▼
 agent_mail_inbound_messages   gmail_conversations
 attentionItems table           gmail_agent_actions

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 OUTBOUND FLOWS — CHANNEL: AGENTMAIL (SAFE)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

                    ┌──── Admin UI (Reply Queue) ────┐
                    │                                │
                    ▼                                ▼
        agentmail-reply-routes.ts         agentmail-followup-routes.ts
        POST /:id/approve                 POST /:id/approve
                    │                                │
                    ▼                                ▼
          [SEND GUARD CHECK] ◄──────────────────────┘
          - Emergency pause?
          - Suppression list?
          - Daily cap?
                    │
                    ▼
        agentmail-service.ts
        sendAgentEmail() → agentmail.to API
                    │
                    ▼
          [createOutcomeOnSend()] → ai_revenue_events
          [writeTimeline()] → agent_operating_timeline
                    │
                    ▼
          ✅ EMAIL DELIVERED (revenue@|hiring@|scheduling@|support@|operations@|ceo@)

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 OUTBOUND FLOWS — CHANNEL: SENDGRID
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

 ┌─────────────────────────────────────────────────────────────────┐
 │ PATH A — Transactional (booking/reminder/cancel/welcome/reset)  │
 │ Trigger: Server-side event (booking created, etc.)              │
 │ sendBookingConfirmationEmail() etc.                             │
 │                     │                                           │
 │                     ▼                                           │
 │              sendEmail() [central]                              │
 │         1. Emergency pause check                                │
 │         2. 15-min dedup cache                                   │
 │         3. User opt-out check                                   │
 │         4. Prospect opt-out check                               │
 │                     │ all pass                                  │
 │                     ▼                                           │
 │         ✅ SendGrid API → DELIVERED                             │
 └─────────────────────────────────────────────────────────────────┘

 ┌─────────────────────────────────────────────────────────────────┐
 │ PATH B — Scheduled Email Agent (initial B2B outreach)           │
 │ Trigger: Daily at 8:30 AM (cron_8_30am)                         │
 │                                                                 │
 │  org.autoSend = false?  →  draft queued, await human approval   │
 │  org.autoSend = true?   →  ↓ CONTINUE AUTO-SEND                │
 │                                                                 │
 │  [No policy engine check]                                       │
 │  [Internal daily cap check: sentToday >= dailyLimit]            │
 │                                                                 │
 │  sendTeamTrainingOutreachEmail() → sendEmail() [central guards] │
 │  → scheduleFollowUpsForDraft() [feeds PATH C/D queue]           │
 │  ✅ EMAIL DELIVERED                                             │
 └─────────────────────────────────────────────────────────────────┘

 ┌─────────────────────────────────────────────────────────────────┐
 │ PATH C — Follow-Up Cron (hourly)                                │
 │ Trigger: setInterval(processFollowUpsForOrg, 60min)             │
 │                                                                 │
 │  evaluatePolicy() ──► approval_required → gmail_agent_actions   │
 │                  └──► auto_execute ↓ CONTINUE AUTO-SEND         │
 │                  └──► block → stop                              │
 │                                                                 │
 │  [Policy error fallback → defaults to auto_execute! ⚠️]        │
 │  [No Send Guard]                                                │
 │                                                                 │
 │  sendTeamTrainingOutreachEmail() → sendEmail() [central guards] │
 │  ✅ EMAIL DELIVERED                                             │
 └─────────────────────────────────────────────────────────────────┘

 ┌─────────────────────────────────────────────────────────────────┐
 │ PATH D — Auto-Execution Engine (every 5 minutes)                │
 │ Trigger: setInterval(runAutoExecutionCycle, 5min)               │
 │                                                                 │
 │  evaluatePolicy() ──► approval_required → queued                │
 │                  └──► auto_execute ↓ CONTINUE AUTO-SEND         │
 │                                                                 │
 │  [No Send Guard]                                                │
 │  [SHARES SAME QUEUE AS PATH C — duplicate risk!] ⚠️            │
 │                                                                 │
 │  sendTeamTrainingOutreachEmail() → sendEmail() [central guards] │
 │  ✅ EMAIL DELIVERED                                             │
 └─────────────────────────────────────────────────────────────────┘

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 OUTBOUND FLOWS — CHANNEL: GMAIL API (CRITICAL RISK)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

 ┌─────────────────────────────────────────────────────────────────┐
 │ PATH E — Gmail Direct Send (UNCONDITIONAL AUTO-SEND) ⛔          │
 │ Trigger: AI tool call (agent_tools/implementations.ts)          │
 │         or any code calling gmailSendEmail()                    │
 │                                                                 │
 │  approvalRequired = FALSE (hardcoded)                           │
 │  status = "executed" (hardcoded)                                │
 │                                                                 │
 │  NO emergency pause check                                       │
 │  NO dedup cache                                                 │
 │  NO opt-out check                                               │
 │  NO daily cap check                                             │
 │  NO policy engine evaluation                                    │
 │  NO Send Guard                                                  │
 │                                                                 │
 │  gmail.ts:sendMessage() → Gmail API                             │
 │  ✅ EMAIL DELIVERED (unconditionally)                           │
 └─────────────────────────────────────────────────────────────────┘

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 SAFE PROPOSAL PATHS (NEVER AUTO-SEND)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

 Lead Recovery Cron (15 min)
   → approvalRequired: true, status: "proposed"
   → gmailAgentActions table
   → awaits human approval in /admin/ai-approvals

 Agent Action Executor (5 min poll)
   → evaluatePolicy()
   → all email actions deferred to approval queue
   → awaits human approval

 AgentMail Follow-Up Cron (20 min)
   → pending_review status
   → creates Attention Item
   → awaits human approval via /api/agentmail/followups/:id/approve
```

---

## Phase 9 — Future State Recommendations {#phase-9}

Findings are ranked by severity and impact.

### 9.1 🔴 CRITICAL — Fix Gmail Auto-Send (Priority 1)

**Problem:** `gmailSendEmail()` in `gmail-agent-service.ts` sends unconditionally with zero guards and `approvalRequired: false`.

**Recommended Fix:**
1. Add an approval gate: change `approvalRequired: false` → `approvalRequired: true` and change `status: "executed"` → `status: "proposed"`. Call `gmailCreateDraft()` instead of `gmailSendEmail()` from agent tool implementations, letting humans send from their Gmail drafts.
2. OR: If auto-send via Gmail must be retained, add the same guard chain as `sendEmail()`: emergency pause check → opt-out check → policy engine evaluation.
3. Add a per-org Gmail daily send cap stored in settings.
4. Wire `gmailSendEmail()` through `evaluatePolicy()` before any send.

**Files to change:** `server/services/gmail-agent-service.ts`, `server/agent-tools/implementations.ts`

### 9.2 🔴 CRITICAL — Fix Follow-Up Race Condition (Priority 2)

**Problem:** `follow-up-cron.ts` (hourly) and `auto-execution-engine.ts` (every 5 minutes) both read and act on the same follow-up queue without a mutex. A follow-up item can be sent twice.

**Recommended Fix:**
1. Add a `claimed_by` column to the follow-ups table with a unique constraint.
2. Use `UPDATE ... SET status = 'processing', claimed_by = :claimant WHERE id = :id AND status = 'pending' RETURNING id` before processing — the row-level atomic update acts as a distributed mutex.
3. OR: Consolidate processing into a single process (remove auto-execution-engine's follow-up handling and let only follow-up-cron own it).

**Files to change:** `server/email-agent/follow-up-cron.ts`, `server/email-agent/auto-execution-engine.ts`, DB schema.

### 9.3 🟠 HIGH — Apply Send Guard to All Auto-Send Paths (Priority 3)

**Problem:** `send-guard-service.ts` is only applied in the AgentMail reply path. The cron auto-send paths (Follow-Up Cron, Auto-Execution Engine, Scheduled Email Agent) bypass it.

**Recommended Fix:**
Create a shared `guardedSendEmail()` function that wraps `sendTeamTrainingOutreachEmail()` with a Send Guard check. All automated send paths should call this instead of calling `sendTeamTrainingOutreachEmail()` directly.

**Files to change:** New shared helper, all cron send paths.

### 9.4 🟠 HIGH — Add Policy Engine to Scheduled Email Agent (Priority 4)

**Problem:** `scheduled-email-agent.ts` controls auto-send via a simple boolean `org.autoSend` setting. It does NOT call `evaluatePolicy()`. This means the 11-check policy system (daily caps, engagement scores, lead quality, etc.) has no effect on initial outreach.

**Recommended Fix:**
Add an `evaluatePolicy()` call in `runEmailAgentForOrg()` before each prospect send. Use the policy decision to either send or queue for approval, consistent with how follow-up paths work.

### 9.5 🟠 HIGH — Fix Policy Error Fallback in Follow-Up Cron (Priority 5)

**Problem:** In `follow-up-cron.ts`, if `evaluatePolicy()` throws an error, the catch block defaults to `auto_execute`:
```typescript
// line ~298-302
} catch (e) {
  console.warn(`[FollowUp] Policy evaluation error ... defaulting to auto_execute`);
  decision: "auto_execute"
}
```

**Recommended Fix:** On policy evaluation error, default to `approval_required`, not `auto_execute`. A system error should never cause MORE permissive behavior.

### 9.6 🟡 MEDIUM — Centralize Daily Cap in sendEmail() (Priority 6)

**Problem:** Daily send caps are implemented independently by each caller (scheduled-email-agent, follow-up-cron, auto-execution-engine). A future send path could bypass this.

**Recommended Fix:** Move daily cap enforcement into `sendEmail()` itself — load `emailAgentSettings.dailyLimit` and `sentToday` count inside `sendEmail()` when `logCtx.type === "outreach"`. This creates a single enforced cap for all automated outreach sends.

### 9.7 🟡 MEDIUM — Add Cross-Channel Coordination (Priority 7)

**Problem:** No coordination exists between AgentMail and Gmail outreach to the same prospect. A prospect could receive emails from both `revenue@agentmail.to` and `coach@gmail.com` without any awareness.

**Recommended Fix:**
1. Add a `last_outreach_channel` and `last_outreach_at` field to the prospects table.
2. Check this before any automated send — if the prospect was contacted via another channel within X days, suppress or queue for human review.

### 9.8 🟡 MEDIUM — Promote autoSend UI Warning (Priority 8)

**Problem:** The `autoSend` org setting in Email Agent settings is a boolean toggle that controls whether the platform sends emails to real B2B prospects without human review. If turned on carelessly, it could result in bulk spam.

**Recommended Fix:** Add a prominent confirmation dialog when enabling `autoSend`, displaying: "When enabled, the system will automatically send emails to business prospects without human approval. Are you sure?" Also add a visible banner on the email agent page when auto-send is active.

### 9.9 🟢 LOW — Build a Unified Send Audit Log (Priority 9)

**Problem:** Email activity is logged across multiple separate tables: `communication_logs`, `gmail_agent_actions`, `agent_mail_inbound_messages`, `outreach_drafts` sent events, `email_trigger_events`. There is no single view of all emails sent across all channels.

**Recommended Fix:** Create an `outbound_email_audit_log` table with: `id, org_id, channel (sendgrid|gmail|agentmail), recipient_email, subject, triggered_by, auto_sent (bool), policy_decision, sent_at, status`. All send paths write here. This enables a `/admin/email-audit` page showing every email the system has ever sent or attempted to send.

### 9.10 🟢 LOW — Add Password Reset Rate Limiting (Priority 10)

**Problem:** `sendPasswordResetEmail()` bypasses dedup, branding, and org checks. There is no server-side rate limit on how often reset emails can be requested for the same address.

**Recommended Fix:** Add the 15-minute dedup cache check to `sendPasswordResetEmail()` using `_dedupKey(toEmail, "password_reset")`, and add a rate-limit check at the route level (e.g., max 3 reset requests per email per hour).

---

## Phase 10 — Executive Summary {#phase-10}

### Overall Assessment

The TrainEfficiency communication architecture is **sophisticated and largely well-designed** but has **3 critical risks** and **2 high-priority structural gaps** that require remediation before the platform can be considered production-safe for high-volume automated outreach.

### Architecture Strengths

1. **AgentMail is exemplary.** Every outbound send is human-gated. The inbound router is idempotent. The Send Guard is correctly wired in. This should be the model for all channels.

2. **SendGrid's central `sendEmail()` is well-protected.** Emergency pause, dedup cache, and opt-out checks are correctly placed inside the function, ensuring all SendGrid sends inherit these guards regardless of origination.

3. **Safe proposal paths are genuinely safe.** Lead Recovery Cron, Agent Action Executor, and AgentMail Follow-Up service never auto-send. Their approval flags are correctly set.

4. **Policy Engine architecture is sound.** The Autonomy Policy Engine's 11-check design is the right approach to governing automated sends. The problem is incomplete adoption, not flawed design.

5. **Observability is good.** CEO Heartbeat timelines, trigger event logging, attention inbox, and revenue attribution are well-implemented and provide strong after-the-fact visibility.

### Critical Risks

| Risk | Severity | File | Impact |
|------|---------|------|--------|
| Gmail auto-send with zero guards | 🔴 CRITICAL | `gmail-agent-service.ts:249` | Emails sent to anyone with no pause/opt-out/cap protection |
| Follow-up duplicate send race | 🔴 CRITICAL | `follow-up-cron.ts` + `auto-execution-engine.ts` | Prospects receive multiple duplicate follow-up emails |
| Policy error defaults to auto_execute | 🔴 CRITICAL | `follow-up-cron.ts:298` | A system failure makes sending MORE permissive |

### High-Priority Gaps

| Gap | Severity | Files Affected |
|-----|---------|---------------|
| Send Guard not applied to cron auto-send paths | 🟠 HIGH | All 3 SendGrid cron paths |
| Scheduled Email Agent bypasses policy engine | 🟠 HIGH | `scheduled-email-agent.ts` |

### Key Metrics at a Glance

| Metric | Count/Status |
|--------|-------------|
| Outbound channels | 3 (SendGrid, Gmail, AgentMail) |
| Active background processes | 6 |
| Auto-send capable paths | 4 (PATH B, C, D, E) |
| Paths with full guard coverage | 1 (AgentMail only) |
| Paths with partial guard coverage | 3 (SendGrid crons — inline guards in sendEmail()) |
| Paths with zero guard coverage | 1 (Gmail — PATH E) |
| Paths requiring human approval always | 4 (AgentMail reply, AgentMail follow-up, Lead Recovery, Agent Action Executor) |
| Paths with conditional approval | 3 (Follow-Up Cron, Auto-Execution Engine, Scheduled Agent) |
| Known duplicate execution risks | 2 (cron race + scheduled agent) |

### Recommended Remediation Order

```
Week 1 (Critical Fixes):
  1. Fix gmailSendEmail() — add approval gate or add all missing guards
  2. Fix follow-up race condition — add atomic claim before processing
  3. Fix policy error fallback — change auto_execute default to approval_required

Week 2 (High Priority):
  4. Apply Send Guard to all cron send paths
  5. Add policy engine evaluation to Scheduled Email Agent

Week 3 (Medium Priority):
  6. Add cross-channel coordination to prevent AgentMail + Gmail double-send
  7. Add autoSend confirmation dialog and active-state banner

Ongoing:
  8. Centralize daily cap in sendEmail()
  9. Build unified send audit log at /admin/email-audit
  10. Add password reset rate limiting
```

### Sign-Off

This audit was performed read-only on June 6, 2026. All findings reflect the codebase state as of that date. No code was modified. Remediation of risks should be performed in order of severity with appropriate testing at each step, particularly for the Gmail and duplicate-send fixes which affect live outreach paths.

---

*Audit performed by: Replit Agent (Architecture Audit Mode)*  
*Files reviewed: 18 server-side files + grep analysis across full codebase*  
*Phases completed: 10 of 10*
