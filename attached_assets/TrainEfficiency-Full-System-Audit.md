# TrainEfficiency — Full System Audit Report
**Date:** June 06, 2026  
**Scope:** Integrations, Agent Architecture, and Hermes Readiness  
**Status:** Audit Only — No Code Changes Made

---

## A. Executive Summary

TrainEfficiency is a sophisticated, multi-layered AI-powered business operating system built on top of a strength-and-conditioning scheduling platform. Over approximately 25 build phases, it has evolved from a basic multi-tenant scheduler into a full autonomous-agent platform with institutional memory, predictive forecasting, outcome attribution, and a self-improving software layer.

**What is real and working:**
- CEO Heartbeat orchestration (30-min cron, live DB reads, Obsidian writes)
- Autonomy scoring engine and policy guardrails
- Executive, Revenue, Growth, Scheduling, Retention, and Client Success agents
- Auto-execution engine with safety gates
- AgentMail service (6 mailboxes, human-gated approval flow)
- Obsidian integration (note creation, search, frontmatter classification)
- SendGrid, Stripe, Google Calendar, Gmail, and Slack integrations (all live)
- Outcome intelligence tables and outcome attribution bridge
- PAIL (Persistent Athlete Intelligence Layer)
- Hermes Learning Engine (core logic live, partial automation)

**What is partially real / heuristic:**
- Business Twin (real inputs for current state, but projections use hardcoded multipliers)
- Forecast accuracy (Retention Rate hardcoded at 0.82; scenario impacts use fixed multipliers)
- Confidence scores throughout Platform Brain and Forecast dashboards

**What is placeholder / unwired:**
- Composio tool layer (planned, no implementation)
- Phase 4–10 expansion routes (sparse, some with missing `requireRole` guards)
- Many admin dashboards navigable only via direct URL (not linked in sidebar)
- PR Tracker / PR Intelligence (duplicate systems)
- Simulator dashboard (mocked projections)

**Top 3 risks:**
1. Auth gaps in Phase 4+ routes — missing `requireRole` middleware on workforce write paths
2. Silent catch blocks in `agent-action-executor.ts` hide execution failures
3. Hardcoded fallback values (`rev30d || 50000_00`) make dashboards appear live when data is missing

---

## B. Current Architecture Map

```
┌─────────────────────────────────────────────────────────┐
│                    CEO Heartbeat                        │
│         30-min cron · server/services/ceo-heartbeat-service.ts │
│  Reads: DB priorities, Obsidian context                 │
│  Writes: ceo_heartbeat_runs, agent_operating_timeline,  │
│          Obsidian /CEO Heartbeat, /Daily Reports        │
└──────────────────────┬──────────────────────────────────┘
                       │ coordinates
     ┌─────────────────┼─────────────────────────┐
     ▼                 ▼                         ▼
Executive Agent    Revenue Agent         Software Improvement
(orchestrator)     (daily 8AM)           Agent (1hr cooldown)
     │
     ├─► Growth Agent
     ├─► Scheduling Agent
     ├─► Retention Agent
     └─► Client Success Agent

┌────────────────────────────────────────┐
│         Auto-Execution Engine          │
│  server/email-agent/auto-execution-engine.ts │
│  Gate: Policy Engine → Autonomy Score  │
│  Output: SendGrid email or draft       │
└────────────────────────────────────────┘

┌─────────────────────┐   ┌──────────────────────┐
│   Obsidian Vault    │   │     AgentMail         │
│  /CEO Heartbeat     │   │  6 mailboxes          │
│  /Agent Decisions   │   │  Draft → Approve flow │
│  /Hermes Learning   │   │  Outcome tracking     │
│  /Playbooks         │   │  Follow-up sequences  │
│  /Software KB       │   └──────────────────────┘
│  /Decision Journal  │
└─────────────────────┘

┌─────────────────────────────────────────────────┐
│            Outcome Intelligence Layer           │
│  agent_communication_outcomes                   │
│  agent_decision_outcomes                        │
│  decision_trust_registry                        │
│  Outcome Bridge → closes attribution loop       │
└─────────────────────────────────────────────────┘

┌──────────────────────────────────────────┐
│      Business Twin / Forecast Engine     │
│  server/services/forecast-engine.ts      │
│  Real: bookings, leads, users, events    │
│  Heuristic: projections, scenarios       │
└──────────────────────────────────────────┘

┌─────────────────────────────────────────────────┐
│            Autonomy & Trust Layer               │
│  decision_trust_registry · autonomy_overrides   │
│  autonomous_action_queue                        │
│  Score formula: Success(40%) + Freq(20%) +      │
│  Confidence(20%) + Revenue(10%) - Risk(10%)     │
└─────────────────────────────────────────────────┘
```

---

## C. Agent-by-Agent Breakdown

### C1. Executive Agent
| Field | Detail |
|---|---|
| **File** | `server/agents/executive-agent.ts` |
| **Trigger** | Manual (dashboard) + Hourly cron (if last brief >20h old) |
| **Responsibilities** | Orchestrates sub-agents, synthesizes cross-agent insights, computes org health score, generates Executive Briefs |
| **Inputs** | Org ID + outputs from all 5 sub-agents |
| **Outputs** | `OrchestratorResult` (signals, recs, health score), `executive_briefs` DB record |
| **Database Tables** | `executive_briefs`, `team_training_prospects`, `team_training_deals`, `bookings`, `userSubscriptions` |
| **Obsidian Writes** | Decision Journal entries for strategic recommendations |
| **AgentMail** | None direct — delegates to sub-agents |
| **TrainChat** | None direct |
| **Gaps** | No org-scoping guard on the hourly cron; brief freshness check is time-based not data-change-based |

### C2. Revenue Agent
| Field | Detail |
|---|---|
| **File** | `server/revenue-agent.ts` |
| **Trigger** | Manual scan + Daily cron at 8 AM via `startRevenueAgentCron` |
| **Responsibilities** | Scans active deals/hot leads, identifies follow-up actions, re-engages stalled proposals |
| **Inputs** | `teamTrainingDeals`, `teamTrainingProspects`, `revenueAgentSettings` |
| **Outputs** | `revenueAgentActions` (pending DB records), `revenueAgentRuns` status |
| **Database Tables** | `revenue_agent_actions`, `revenue_agent_runs`, `team_training_deals`, `team_training_prospects` |
| **Obsidian Writes** | Decision Journal via Executive Agent coordination |
| **AgentMail** | Uses `revenue` mailbox for outbound deals and partner inquiries |
| **TrainChat** | None |
| **Gaps** | Action approval flow not always wired to outcome attribution; stale actions can accumulate without cleanup |

### C3. Growth Agent
| Field | Detail |
|---|---|
| **File** | `server/agents/growth-agent.ts` |
| **Trigger** | Called by Executive Agent |
| **Responsibilities** | Analyzes sales pipeline, identifies hot leads and stalled deals, runs lead source conversion analysis |
| **Inputs** | `teamTrainingProspects`, `teamTrainingDeals` |
| **Outputs** | `GrowthSignal[]`, `GrowthRecommendation[]`, pipeline summary metrics |
| **Database Tables** | `team_training_prospects`, `team_training_deals` |
| **Obsidian Writes** | Via Executive Agent's Decision Journal |
| **AgentMail** | None direct |
| **Gaps** | No individual persistence of growth signals; data is lost if Executive Brief is not generated |

### C4. Scheduling Agent
| Field | Detail |
|---|---|
| **File** | `server/agents/scheduling-agent.ts` |
| **Trigger** | Called by Executive Agent |
| **Responsibilities** | Monitors calendar utilization, identifies revenue gaps (unfilled slots), cancellation spike detection |
| **Inputs** | `bookings`, `availabilityBlocks`, `services`, `coachProfiles` |
| **Outputs** | `SchedulingSignal[]`, `SchedulingRecommendation[]`, revenue gap in cents, utilization % |
| **Database Tables** | `bookings`, `availability_blocks`, `services`, `coach_profiles` |
| **Obsidian Writes** | Via Executive Agent |
| **AgentMail** | Uses `scheduling` mailbox for booking/reschedule emails |
| **TrainChat** | Indirect — TrainChat powers workout generation linked to sessions |
| **Gaps** | Revenue gap calculation does not account for seasonal variation |

### C5. Retention Agent
| Field | Detail |
|---|---|
| **File** | `server/agents/retention-agent.ts` |
| **Trigger** | Called by Executive Agent |
| **Responsibilities** | Churn detection (inactive clients >30d), frequent cancellation flagging, expiring subscription alerts |
| **Inputs** | `bookings`, `users`, `userSubscriptions`, `userProfiles` |
| **Outputs** | `RetentionSignal[]`, `RetentionRecommendation[]`, churn risk summary |
| **Database Tables** | `bookings`, `users`, `user_subscriptions`, `user_profiles` |
| **Obsidian Writes** | Via Executive Agent |
| **AgentMail** | None direct |
| **Gaps** | No automated outreach triggered by retention signals; recommendations are advisory only |

### C6. Client Success Agent
| Field | Detail |
|---|---|
| **File** | `server/agents/client-success-agent.ts` |
| **Trigger** | Called by Executive Agent |
| **Responsibilities** | Monitors session completion rates, flags No Show patterns, adherence monitoring |
| **Inputs** | `bookings`, `userProfiles` |
| **Outputs** | `ClientSuccessSignal[]`, `ClientSuccessRecommendation[]` |
| **Database Tables** | `bookings`, `user_profiles` |
| **Obsidian Writes** | Via Executive Agent |
| **Gaps** | Not connected to PAIL athlete memory; completion rates don't feed into athlete risk flags |

### C7. Software Improvement Agent
| Field | Detail |
|---|---|
| **File** | `server/services/software-improvement-agent.ts` |
| **Trigger** | Periodic system scan; 1-hour cooldown enforced per org |
| **Responsibilities** | Scans workflow failures, email trigger blocks, action log errors; generates Codex-ready engineering tasks |
| **Inputs** | `workflow_runs` failures, `email_trigger_events` blocks, `unified_agent_action_log` errors |
| **Outputs** | `software_improvement_tasks` (structured issues with Codex prompts and repro steps) |
| **Database Tables** | `software_improvement_tasks`, `workflow_runs`, `email_trigger_events`, `unified_agent_action_log` |
| **Obsidian Writes** | Software KB entries (`/Software KB` folder) and `/Software Improvements` folder |
| **Gaps** | Codex execution hook not live — tasks are generated but not automatically submitted to Codex/LLM for resolution; no feedback loop from fix completion back to task status |

### C8. Auto-Execution Engine
| Field | Detail |
|---|---|
| **File** | `server/email-agent/auto-execution-engine.ts` |
| **Trigger** | Hooked into communication workflow after agent scanning |
| **Responsibilities** | Executes high-confidence actions without human intervention; enforces daily limits and Safe Action filters |
| **Inputs** | `GlobalActionQueue` from `GlobalPriorityEngine`, `emailAgentSettings`, Policy Engine results |
| **Outputs** | Executed outreach via `guardedSendTeamTrainingOutreachEmail`, `AutoExecutionLog`, updated `emailTriggerEvents` |
| **Safety Gates** | Policy Engine (11 checks) → Autonomy Score (≥76 required) → Emergency Pause guard → Daily cap |
| **Obsidian Writes** | Agent decision notes via `writeAgentDecision` |
| **Gaps** | `auto_execute_deferred` status means many real-world sends are gated at the final step; outcome feedback from deferred actions is incomplete |

---

## D. Tool Integration Matrix

| Integration | Status | Primary Files | What Works | What is Mocked/Missing |
|---|---|---|---|---|
| **Obsidian** | ⚠️ Conditional | `server/services/obsidian-service.ts`, `server/obsidian-routes.ts` | Note create/append/search, frontmatter, Hermes learning, context retrieval | Requires `OBSIDIAN_BASE_URL` + `OBSIDIAN_API_KEY` env vars; URL must have trailing slash stripped; depends on ngrok tunnel being live |
| **AgentMail** | ✅ Real | `server/services/agentmail-service.ts`, `server/agentmail-routes.ts`, `server/agentmail-reply-routes.ts`, `server/agentmail-followup-routes.ts` | 6 mailboxes, draft → approval flow, follow-up sequencing, inbound classification, outcome tracking | Requires AgentMail API credentials in env; webhook endpoint must be publicly accessible |
| **TrainChat API** | ✅ Real (with fallback) | `server/services/trainchat-client.ts` | Program generation, session building, exercise swaps; AES-256 encrypted org-level key overrides | Falls back to OpenAI `gpt-4o-mini` if unreachable; requires `TRAINCHAT_API_KEY` + `TRAINCHAT_API_BASE_URL` |
| **SendGrid** | ✅ Real | `server/email.ts`, `server/integration-runtime.ts` | Welcome emails, booking confirmations, reminders; emergency pause guard; deduplication | Requires `SENDGRID_API_KEY` or Replit Connector; from address hardcoded to `bryan.jones@efficiencystrengthtraining.com` |
| **Stripe** | ✅ Real | `server/stripeClient.ts`, `server/connectors/stripe-invoicing.ts`, `server/webhookHandlers.ts` | Payment processing, invoicing, webhooks, DB sync via `stripe-replit-sync` | Requires `STRIPE_SECRET_KEY` + `STRIPE_PUBLISHABLE_KEY`; known issues with payment credit persistence (see audit attachment) |
| **Google Calendar** | ✅ Real | `server/integrations/google-calendar.ts` | Read availability, insert events; OAuth2 flow | Credentials stored in `external_integrations` table; OAuth refresh not fully automated |
| **Gmail** | ✅ Real | `server/integrations/gmail.ts`, `server/services/gmail-agent-service.ts` | OAuth2 flow, message sending, agent action drafting | Gmail send path gated to draft-only per communication safety remediation |
| **Slack** | ✅ Real | `server/integrations/slack.ts` | Incoming webhooks + Bot API `chat.postMessage`; operational alerts and executive summaries | Requires webhook URL or Bot token in `external_integrations` |
| **OpenAI** | ✅ Real | Used across all AI services | GPT-4o for enrichment/research; `gpt-4o-mini` for summaries, outcome reviews, playbook generation | Requires `OPENAI_API_KEY`; web_search_preview tool used for live email discovery |
| **Composio** | ❌ Placeholder | None | Nothing | No implementation exists; native tools in `server/agent-tools/implementations.ts` |
| **Codex/Software hooks** | ⚠️ Partial | `server/services/software-improvement-agent.ts` | Task generation with Codex prompts | No automated submission to Codex; tasks sit in `software_improvement_tasks` waiting for manual action |

### Environment Variables Required
| Variable | Purpose |
|---|---|
| `OBSIDIAN_BASE_URL` | Obsidian Local REST API endpoint (ngrok URL) |
| `OBSIDIAN_API_KEY` | Obsidian plugin API key |
| `TRAINCHAT_API_KEY` | TrainChat external API |
| `TRAINCHAT_API_BASE_URL` | TrainChat base URL |
| `OPENAI_API_KEY` | OpenAI (fallback + primary AI) |
| `SENDGRID_API_KEY` | Email (or Replit Connector) |
| `STRIPE_SECRET_KEY` | Stripe payments |
| `STRIPE_PUBLISHABLE_KEY` | Stripe frontend |
| `INTEGRATION_ENCRYPTION_SECRET` | AES-256 key encryption for org overrides |
| `DATABASE_URL` | PostgreSQL connection |
| `REPLIT_CONNECTORS_HOSTNAME` | Replit connector proxy |

---

## E. Database / Table Map

### Agent Infrastructure
| Table | Purpose | Written By | Read By |
|---|---|---|---|
| `org_installed_agents` | Active agents per org | Admin UI | All agents, heartbeat |
| `agent_capability_policies` | Per-agent permissions and risk limits | Seed/Admin | Policy engine, autonomy scoring |
| `org_ai_governance_settings` | Global AI guardrails | Admin UI | Auto-execution engine, policy engine |
| `agent_autonomy_settings` | Detailed autonomy controls | Admin UI | Autonomy scoring service |
| `agent_autonomy_decisions` | Audit trail of autonomous choices | Auto-execution engine | CEO Heartbeat, audit dashboards |
| `agent_operating_timeline` | Unified log of all agent actions/recommendations | CEO Heartbeat, all agents | Heartbeat, admin dashboards |
| `decision_trust_registry` | Per-org trust score per decision type | Autonomy scoring service | Scoring engine, auto-execution |
| `autonomy_overrides` | Manual approval/rejection records | Approval flows | Autonomy scoring (override rate) |
| `autonomous_action_queue` | Actions queued for execution or approval | Auto-execution engine | Approval UI, executor |

### Workflow Tables
| Table | Purpose | Written By | Read By |
|---|---|---|---|
| `workflow_registry` | Global directory of executable workflows | Seed/Admin | Orchestrator |
| `workflow_graphs` | Visual definitions for complex processes | Admin | Executor |
| `workflow_graph_versions` | Version history | Admin | Executor |
| `workflow_jobs` | Durable task queue | All agents | Job runner |
| `workflow_runs` | Execution state | Job runner | Software improvement agent |
| `workflow_step_runs` | Step-level execution history | Job runner | Audit dashboards |
| `adaptive_workflows` | Data-evolving workflows | Learning engine | Orchestrator |
| `retention_workflows` | Client recovery workflows | Retention agent | Scheduler |
| `job_execution_locks` | Concurrency locks | CEO Heartbeat | Heartbeat, executor |

### Outcome & Intelligence Tables
| Table | Purpose | Written By | Read By |
|---|---|---|---|
| `agent_decision_outcomes` | Every agent recommendation vs. actual result | All agents | Hermes, autonomy scoring, CEO review |
| `agent_communication_outcomes` | Outreach outcome tracking (sent → replied → booked) | Outcome bridge | Intelligence service, CEO Heartbeat |
| `agent_rule_effectiveness` | Compounding rule-level performance | Intelligence service | Auto-execution prompt builder |
| `agent_message_learning_rules` | Win/lose rules by outcome score | Hermes, learning engine | Agent prompt builders |
| `agent_perf_scores` | Rolling agent performance metrics | Intelligence service | CEO Heartbeat, autonomy scoring |
| `workflow_outcomes` | Workflow-level result attribution | Job runner | Forecast engine |
| `org_ai_workforce_outcomes` | High-level business impact attribution | CEO Heartbeat | Command Center dashboards |
| `ai_revenue_events` | Revenue event attribution | Approval flows, outcome bridge | Revenue dashboards, forecast engine |

### Forecasting & Business Twin
| Table | Purpose | Written By | Read By |
|---|---|---|---|
| `business_twin_state` | Digital twin snapshot | Forecast engine | Risk/opportunity signal generation |
| `business_forecasts` | 30/60/90/180-day projections | Forecast engine | CEO Heartbeat, strategy dashboards |
| `risk_signals` | Anomaly flags (revenue decline, lead drop) | Forecast engine | CEO Heartbeat, strategy dashboards |
| `opportunity_signals` | Growth path identification | Forecast engine | CEO Heartbeat, strategy dashboards |
| `scenario_simulations` | What-if simulations | Forecast engine | Strategy dashboard |
| `strategic_plans` | AI-generated strategic objectives | Forecast engine, GPT-4o | Strategy dashboard, Obsidian |
| `forecast_accuracy` | Predicted vs. actual comparisons | Forecast engine | Business OS Score |
| `executive_briefs` | AI summaries for leadership | Executive Agent | Command Center, CEO Heartbeat |
| `ceo_heartbeat_runs` | Heartbeat run records | CEO Heartbeat service | Admin heartbeat dashboard |

### Communications & Playbooks
| Table | Purpose | Written By | Read By |
|---|---|---|---|
| `communication_logs` | Master outbound/inbound traffic record | All comm services | Audit, intelligence |
| `outreach_drafts` | Agent content awaiting approval | Revenue agent, Gmail agent | Approval UI |
| `gmail_agent_actions` | Gmail agent action queue | Gmail agent | CEO Heartbeat (approval count) |
| `gmail_conversations` | External thread context | Gmail integration | Gmail agent |
| `agent_mail_messages` | AgentMail outbound audit | AgentMail service | Communication intelligence |
| `agent_mail_inbound_messages` | AgentMail inbound with classification | AgentMail webhook | Reply router |
| `agent_mail_reply_queue` | Drafted replies awaiting human approval | AgentMail reply service | Approval UI |
| `agent_mail_followups` | Scheduled follow-up sequences | AgentMail follow-up service | Follow-up cron |
| `agent_mail_reply_outcomes` | Approval performance tracking | Approval flow | Communication intelligence |
| `org_playbooks` | Promoted high-performing patterns | Hermes, outcome attribution | Agent prompt builders, Obsidian |

### Athlete Intelligence (PAIL)
| Table | Purpose | Written By | Read By |
|---|---|---|---|
| `athlete_memory_profiles` | Persistent multi-org athlete memory | PAIL service | Workout builder, CEO Heartbeat |
| `athlete_session_outcomes` | Performance and readiness results | Session logging | PAIL learning engine |
| `exercise_effectiveness_scores` | Per-exercise effectiveness by athlete | PAIL service | Workout builder |
| `athlete_risk_flags` | Active risk indicators | PAIL service | CEO Heartbeat |

### Software Improvement
| Table | Purpose | Written By | Read By |
|---|---|---|---|
| `software_improvement_tasks` | Codex-ready engineering issue cards | Software improvement agent | Admin dashboard, (future) Codex hook |

---

## F. Obsidian Memory Flow

```
Agent Action / Event
        │
        ▼
obsidian-service.ts
  buildFrontmatter() → YAML metadata
  (type, agent, department, orgId, severity, date, tags)
        │
        ├─► createNote / appendToNote
        │           │
        │     Folder routing:
        │     ├─ /CEO Heartbeat      ← CEO Heartbeat service (30-min cycle)
        │     ├─ /Agent Decisions    ← Auto-execution engine, Hermes
        │     ├─ /Hermes Learning    ← recordOutcomeLearning()
        │     ├─ /Software KB        ← Software improvement agent
        │     ├─ /Software Improvements ← Software improvement agent
        │     ├─ /Decision Journal   ← Executive, Revenue, Growth agents
        │     ├─ /Daily Reports      ← CEO Heartbeat daily summary
        │     ├─ /Playbooks          ← Promoted patterns from org_playbooks
        │     └─ /SOPs               ← Procedural knowledge
        │
        └─► retrieveAgentContext()   ← BEFORE every agent acts
                    │
              Multi-category search:
              (decisions, fixes, recs, learnings)
                    │
              Injected into agent prompt as:
              "## Institutional Memory Context"
```

**Confirmed writing correctly:**
- ✅ CEO Heartbeat reports (`/CEO Heartbeat` folder, `YYYY-MM-DD Heartbeat.md`)
- ✅ Agent decisions (auto-execution engine writes after each automated action)
- ✅ Software KB (software improvement agent)
- ✅ Hermes learnings (`recordOutcomeLearning`, `writeHermesLearning`)
- ✅ Daily Reports (heartbeat appends top priorities)
- ⚠️ CEO reviews — written via `agent-outcome-attribution-service.ts` but only when a CEO review cycle is triggered, not automatically every 24h
- ⚠️ Playbooks — written only when Hermes promotes a pattern to `org_playbooks`; not on a schedule
- ⚠️ Strategic plans — written when `generateStrategicPlan` is called from forecast engine; not automated

**Known dependency:** All Obsidian writes require `OBSIDIAN_BASE_URL` and `OBSIDIAN_API_KEY` to be live. If the ngrok tunnel drops, Obsidian writes fail silently (try/catch absorbed). The system continues to function but loses its institutional memory layer.

---

## G. AgentMail Communication Flow

```
Inbound Email (webhook)
        │
        ▼
agentmail-routes.ts (POST /api/agentmail/webhook)
        │
        ▼
agentmail-inbound-router.ts
  classify() → type:
  (new_lead | booking_request | software_bug_report | spam_or_noise)
        │
        ▼
agent_mail_inbound_messages (stored with confidence score)
        │
        ▼
agentmail-reply-routes.ts
  draftReply() → GPT-4o-mini generates response
        │
        ▼
agent_mail_reply_queue (DRAFT status)
        │
        ▼
Human Approval (attention_items + admin UI)
        │
   ┌────┴────┐
APPROVE     REJECT
   │            │
   ▼            ▼
agentmail-    reject logged,
service.ts    draft discarded
send()
   │
   ▼
agent_mail_messages (SENT audit log)
   │
   ▼
agent_mail_reply_outcomes (performance: edit%, approve%, response time)
   │
   ▼
Follow-up sequencing:
agentmail-followup-service.ts
  createFollowupSequence() → agent_mail_followups
  startFollowupCron() (20-min interval)
  detectStopConditions() → auto-cancel if replied or converted
```

**6 Defined Mailboxes:**
| Mailbox | Agent | Purpose |
|---|---|---|
| `revenue` | Revenue Agent | Deals, upsells, partner inquiries |
| `hiring` | Hiring Agent | Recruitment and candidates |
| `scheduling` | Scheduling Agent | Bookings, reschedules |
| `support` | Support Agent | Client success, bugs |
| `operations` | Operations Agent | Internal ops, vendors |
| `ceo` | CEO Heartbeat | Strategic summaries, executive outreach |

**Outcome Attribution Status:**
- ✅ `agent_mail_reply_outcomes` tracks response rate and edit rate
- ✅ `detectStopConditions` closes follow-up sequences on conversion
- ⚠️ AgentMail outcomes not currently wired to `agent_communication_outcomes` — the two outcome systems are parallel, not unified
- ⚠️ AgentMail conversation content is **not** written to Obsidian — no institutional memory of specific email conversations

---

## H. Outcome → Trust → Forecast Feedback Loop

```
Agent Action Executed
        │
        ▼
agent_communication_outcomes (sent → replied → meeting_booked → converted)
        │
        ▼
Outcome Bridge Service (server/services/outcome-bridge-service.ts)
  Auto-links business events (deal stage changes, bookings) to origin comms
        │
        ▼
agent_decision_outcomes
  success_score (0-100), revenue_cents, expected vs actual
        │
        ├─► agent_rule_effectiveness (win rules / lose rules)
        │         │
        │         ▼
        │   Injected into next agent prompt
        │   (outcome-weighted rules: "When X, do Y → 78% success")
        │
        ├─► decision_trust_registry
        │   (success_rate updated, human_overrides incremented on reject)
        │         │
        │         ▼
        │   autonomy-scoring-service.ts
        │   Recalculates execution mode:
        │   Observe → Recommend → Queue → Execute
        │
        ├─► agent_perf_scores (rolling metrics per agent type)
        │
        ├─► forecast_accuracy (predicted vs actual → Business OS Score)
        │
        └─► Hermes Learning Engine
              recordOutcomeLearning() → Obsidian /Hermes Learning
              Playbook candidate promotion → org_playbooks
              Autonomy readiness recommendations
```

**What feeds back correctly:**
- ✅ Rule effectiveness → agent prompts (win/lose rules injected)
- ✅ Override rate → autonomy score (overrides degrade score)
- ✅ Outcome bridge → closes attribution from outreach to deal conversion
- ✅ Hermes → Obsidian memory and playbook promotion

**What does NOT feed back:**
- ❌ AgentMail outcomes → `agent_communication_outcomes` (parallel, disconnected)
- ❌ Software improvement task completion → Software improvement agent learning
- ❌ Forecast accuracy → individual agent behavior adjustment (only feeds Business OS Score)
- ❌ PAIL athlete outcomes → Client Success Agent signals
- ⚠️ CEO daily review generation is not on an automated schedule — must be manually triggered

---

## I. Hermes Readiness Score

**Overall Score: 72 / 100**

| Dimension | Score | Notes |
|---|---|---|
| Core logic implemented | 18/20 | `obsidian-service.ts` + `agent-outcome-attribution-service.ts` complete |
| Obsidian write path | 16/20 | Works when Obsidian is live; ngrok dependency is a risk |
| Outcome data availability | 14/20 | `agent_communication_outcomes` populated; AgentMail outcomes disconnected |
| Agent prompt injection | 12/15 | `retrieveAgentContext` wired; search quality depends on vault content |
| Playbook promotion | 6/10 | Logic exists; not on automated trigger, requires manual cycle |
| Autonomy score influence | 6/10 | Hermes recommendations logged but not automatically applied to trust registry |
| CEO review automation | 0/5 | Manual trigger only; not scheduled |

**What needs to happen before Hermes is fully autonomous:**
1. AgentMail outcomes must write into `agent_communication_outcomes`
2. CEO daily review must run on a scheduled trigger (not manual)
3. Playbook promotion must have an automated threshold check (e.g., pattern with >70% success over 5+ instances → auto-promote)
4. Hermes autonomy recommendations must write directly to `decision_trust_registry` (with human opt-in gate)
5. Obsidian connectivity must have a fallback (DB-based memory) when ngrok is down

---

## J. Critical Gaps

### J1. Security / Auth Gaps
| Gap | Location | Risk |
|---|---|---|
| Missing `requireRole` middleware on Phase 4+ workforce write routes | `server/phase10-routes.ts` lines noted; `forecast-routes.ts` custom `getOrgId` | Any authenticated user can trigger agent actions |
| OIDC vs custom auth fragmentation | `getAdminOrgId` in `server/routes.ts` vs per-route `getOrgId` | Org isolation may be inconsistent in newer routes |
| Stripe webhook credit persistence | `server/webhookHandlers.ts` | Known issue; payment sync failures not surfaced to users |

### J2. Silent Failure Risks
| Gap | Location | Impact |
|---|---|---|
| Silent catch blocks in action executor | `server/services/agent-action-executor.ts` lines 105-127 | Agents appear stuck; no user-facing error |
| Obsidian writes absorbed on network failure | `server/services/obsidian-service.ts` all write functions | Memory layer silently drops; dashboards show stale data |
| `auto_execute_deferred` status | Auto-execution engine | Feedback loop broken; outcomes never attributed |

### J3. Fake / Hardcoded Data
| Gap | Location | Impact |
|---|---|---|
| Revenue fallback `rev30d \|\| 50000_00` | `server/services/forecast-engine.ts` | Forecast dashboards appear live with invented data |
| Retention rate hardcoded at `0.82` | `forecast-engine.ts` | Business Twin retention metric is never real |
| Scenario impact multipliers hardcoded (e.g., `new_location` = 1.9x revenue) | `forecast-engine.ts` line ~639 | Simulation results are not org-specific |
| Business OS Score confidence heuristic | `confidenceScore(dataPoints, consistency)` | "93% confidence" is computed, not statistically validated |

### J4. Disconnected Systems
| Gap | Impact |
|---|---|
| AgentMail outcomes ↔ `agent_communication_outcomes` (parallel, not unified) | Hermes cannot learn from AgentMail conversations |
| PAIL athlete outcomes ↔ Client Success Agent | Athlete risk signals do not inform client churn detection |
| Software improvement task completion ↔ agent learning | Tasks generated but never closed in the learning loop |
| Codex hook not live | Software improvement tasks accumulate without automated resolution |
| PR Tracker + PR Intelligence duplicate systems | Dual implementation of same concept; one will drift |

### J5. Navigation / UX Gaps
| Gap | Impact |
|---|---|
| 150+ routes in `client/src/App.tsx`; many not in sidebar | Users cannot discover key dashboards |
| Admin dashboards only accessible via direct URL | `/admin/obsidian`, `/admin/first-10`, `/admin/human-validation`, etc. |
| Phase 4-10 expansion dashboards contain sparse/template data | Users see partially empty dashboards |

### J6. Operational Gaps
| Gap | Impact |
|---|---|
| CEO daily review not scheduled | Outcome → Obsidian → Agent learning cycle breaks unless manually triggered |
| Playbook promotion not automated | Successful patterns sit in `agent_decision_outcomes` without becoming playbooks |
| Forecast accuracy tracking not cross-referenced to adjust agent behavior | Forecast errors do not retrain agent recommendations |
| Follow-up cron is 20-min interval but not monitored | No alerting if cron silently fails |

---

## K. Recommended Next Build: Hermes Integration Plan

**Hermes is the Learning OS.** It should be the bridge between what agents experience (outcomes) and what agents know (memory + trust). Here is the recommended architecture before building.

### K1. What Hermes Should Consume
| Source | Table / API | Trigger |
|---|---|---|
| Communication outcomes | `agent_communication_outcomes` | On status change (replied, booked, converted) |
| AgentMail outcomes | `agent_mail_reply_outcomes` | On approval/send in AgentMail |
| Decision outcomes | `agent_decision_outcomes` | On outcome score update |
| Rule effectiveness | `agent_rule_effectiveness` | On effectiveness recalculation |
| Autonomy overrides | `autonomy_overrides` | On human rejection |
| Forecast accuracy | `forecast_accuracy` | On forecast vs actual comparison |
| CEO reviews | Obsidian `/CEO Heartbeat` + DB CEO review output | On daily review generation |

### K2. Which Events Should Trigger Hermes
1. Any `agent_communication_outcomes` status → `converted` or `lost`
2. Any `autonomy_overrides` human rejection (learn from what humans override)
3. AgentMail `agent_mail_reply_outcomes` approval with significant edit (>30% token diff)
4. CEO Heartbeat completion (30-min cycle end)
5. `forecast_accuracy` variance > 15% on any metric

### K3. Tables Hermes Should Write
| Table | Write | Purpose |
|---|---|---|
| `agent_message_learning_rules` | Create/update win/lose rules | Improve future agent prompts |
| `decision_trust_registry` | Increment success_rate | Raise/lower autonomy score for proven patterns |
| `org_playbooks` | Insert promoted patterns | Formalize high-performing approaches |
| `agent_decision_outcomes` | Log Hermes own "recommendation" decisions | Self-audit trail |
| `agent_perf_scores` | Update rolling metrics | CEO Heartbeat priority inputs |

### K4. Obsidian Folders Hermes Should Write To
- `/Hermes Learning` — Every outcome → observation → learning triplet
- `/Playbooks` — When a pattern is promoted (with evidence summary)
- `/Decision Journal` — When a learning changes a trust recommendation
- `/Agent Decisions` — When Hermes autonomously adjusts an agent's confidence level

### K5. Agent Decisions Hermes Should Influence
- **Revenue Agent**: Which outreach template to use (based on highest win-rule match)
- **Growth Agent**: Which lead segments to prioritize (based on conversion outcome history)
- **Retention Agent**: Which intervention type has highest re-engagement rate
- **Auto-Execution Engine**: Raise/lower autonomy score for specific decision types based on accumulated win/lose evidence
- **CEO Heartbeat**: Surface patterns that have been validated enough to recommend for all orgs

### K6. Playbook Promotion Criteria (Recommended)
A pattern should auto-promote to `org_playbooks` when:
- ≥5 instances of same decision type in `agent_decision_outcomes`
- `success_score` average ≥ 70 across those instances
- At least 1 human approval (not fully autonomous — maintain human in loop for first promotion)
- No override in last 3 instances

### K7. Autonomy Trust Adjustment (Recommended)
Hermes should write to `decision_trust_registry` when:
- A decision type accumulates ≥10 consecutive successes → recommend `+5` to trust score
- A decision type receives 2 human overrides in 7-day window → recommend `-10` to trust score
- These should be logged as "Hermes recommendations" requiring admin opt-in before applied (not auto-applied)

### K8. AgentMail → Hermes Connection (Missing, Must Build)
New connection needed:
1. On every `agent_mail_reply_outcomes` record creation, call `createOutcomeOnSend()` equivalent to write into `agent_communication_outcomes`
2. This closes the loop: AgentMail → outcome attribution → Hermes learning → agent prompt improvement
3. File to modify: `server/agentmail-reply-routes.ts` (approve path) — mirror the pattern already implemented in `server/routes.ts` approval paths

### K9. Forecast Accuracy → Hermes Connection (Partial, Must Close)
Current state: Forecast accuracy writes to `forecast_accuracy` table and feeds `Business OS Score`.  
Missing: Forecast accuracy variance does not influence agent recommendations.  
Recommended: When `forecast_accuracy.actual_value` deviates from `predicted_value` by >15%, Hermes should:
1. Write a learning note to Obsidian `/Hermes Learning`
2. Update the relevant agent's `agent_perf_scores.forecast_accuracy_score`
3. Flag to CEO Heartbeat as a "calibration opportunity"

### K10. Recommended Hermes Build Order
1. **Phase A** — Connect AgentMail outcomes to `agent_communication_outcomes` (one new function in `agentmail-reply-routes.ts`, high leverage, low risk)
2. **Phase B** — Schedule CEO daily review (add a daily cron in `server/index.ts` calling existing `generateCEODailyReview`)
3. **Phase C** — Automate playbook promotion (add threshold check in `ceo-heartbeat-service.ts` each cycle)
4. **Phase D** — Build Hermes as a dedicated service (`server/services/hermes-service.ts`) that listens to outcome events and writes learning notes + trust recommendations
5. **Phase E** — Wire Hermes trust recommendations to `decision_trust_registry` with admin opt-in approval gate
6. **Phase F** — Connect forecast accuracy deviations to Hermes learning (closes the full feedback loop)

---

*End of Audit Report — June 06, 2026*
