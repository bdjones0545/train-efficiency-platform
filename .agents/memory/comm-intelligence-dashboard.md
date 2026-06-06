---
name: Communication Intelligence Dashboard
description: Read-only leadership command center aggregating signals from Gmail, AgentMail, SendGrid, follow-ups, leads, hiring, and support into one dashboard.
---

## What was built

**Page:** `/admin/communication-intelligence`
**Service:** `server/services/communication-intelligence-service.ts`
**Routes:** `server/communication-intelligence-routes.ts`
**UI:** `client/src/pages/admin-communication-intelligence.tsx`

## Data sources queried (read-only)

- `outbound_email_audit_log` — channel stats, block/fail spikes, approval status
- `gmail_agent_actions` — pending proposals, approval rate, by domain
- `agent_mail_inbound_messages` — inbound volume, classification
- `agent_mail_reply_queue` — pending/approved/rejected approvals
- `agent_mail_followups` — pending/overdue sequences
- `email_follow_ups` — follow-up status distribution
- `email_trigger_events` — blocked/executed/missed triggers
- `team_training_prospects` — outreach status, stale leads, never-contacted
- `team_training_outreach_drafts` — response rate, meeting rate
- `email_message_variants` — top performing templates
- `agent_communication_outcomes` — outcome pipeline by domain
- `ai_revenue_events` — credited value by action type
- `team_training_deals` — pipeline value, deals by stage
- `employment_applicants` — hiring funnel by status
- `attention_items` — support issues, escalations
- `lead_intelligence_profiles` — pipeline stage distribution
- `agent_message_feedback` — approval rate, quality scores
- `agentMessageLearningRules` (via feedback join)

## API routes

All at `/api/communication-intelligence/*`:
- `/overview` — today's KPIs (sends/blocks/failures/pending)
- `/channels` — channel performance 7-day window
- `/health` — conversation health score + prospect status
- `/approvals` — approval bottleneck + rates + timing
- `/responses` — response rates, meeting rates, top variants
- `/revenue` — revenue outcomes, deals by stage, AI credit
- `/hiring` — applicant funnel, response rates
- `/support` — open issues, escalations by category
- `/recovery` — stalled conversation detection queue
- `/risks` — risk engine: blocks/fails/duplicates/policy
- `/dashboard` — full aggregate (all 11 queries in parallel)

## Architecture decisions

**Why:** No mutation logic — every function only reads. All queries wrapped in `safeQuery()` which swallows errors and returns empty arrays, so the dashboard never crashes even if a table hasn't been created yet (agentmail tables are lazy-created).

**How to apply:** Any new communication data source should be added to the appropriate service function. Never add sends/approvals/mutations here.

**Recovery queue urgency scoring:** `high` = stale >14d (leads) / >72h overdue (follow-ups); `medium` = 7-14d; `low` = <7d. Queue is sorted by urgency desc.

**Risk engine thresholds:** blocked >50 = critical, >20 = high, >5 = medium. failed >30 = critical, >10 = high. approval backlog >48h: >25 = critical, >0 = medium.
