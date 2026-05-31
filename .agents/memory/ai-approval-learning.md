---
name: AI Approval Inbox + Message Learning (AI Communications Center)
description: Tables, service, and routes for the domain-aware AI Communications Center with coaching feedback, rule extraction, and autonomy progression per domain.
---

## Tables
- `gmail_agent_actions` — has `communication_domain` (backfilled: dealId→team_training, else→athlete_lead)
- `agent_message_feedback` — extended with: coaching_feedback_text, feedback_tags (jsonb), extracted_preferences, extracted_avoid_rules, extracted_do_rules, applies_to_lead_type, applies_to_program, preference_strength, should_apply_globally, communication_domain, outcome_data (jsonb)
- `agent_message_learning_rules` — extracted rules per org (do/avoid/tone/cta/length), communication_domain, status: active/superseded/archived
- `agent_message_revisions` — revision history, communication_domain
- `agent_autonomy_settings` — now keyed by (orgId, messageType, communicationDomain)

## Domains (11)
athlete_lead, parent_lead, team_training, school_partnership, athletic_director, coach_outreach, organization_outreach, business_outreach, employment_opportunity, corporate_wellness, facility_partnership

## Domain Tab Groups (frontend and API)
- athlete → [athlete_lead, parent_lead]
- team_training → [team_training]
- schools → [school_partnership, athletic_director, coach_outreach]
- orgs → [organization_outreach, business_outreach, corporate_wellness, facility_partnership]
- employment → [employment_opportunity]

## Service
`server/services/message-learning-service.ts`:
- `inferCommunicationDomain(row)` — detects domain from communicationDomain, dealId, actionType
- `extractMessageLearningFromFeedback(orgId, feedbackId)` — calls GPT-4o-mini, stores domain-tagged rules async
- `getMessageLearningContext(orgId, messageType, leadContext)` — priority: same domain+type > same domain > global
- `regenerateDraftWithFeedback(opts)` — calls OpenAI with domain context, stores revision
- `getLearningDashboard(orgId)` — returns array of 11 domain entries each with do/avoid/tone/cta/length rules, outcomes, repeated mistakes

## Routes (all in registerRoutes() in server/routes.ts)
- GET /api/ai-approvals?domain=<group> — filters by domain group (athlete/team_training/schools/orgs/employment/all)
- GET /api/ai-approvals/metrics?domain=<group> — domain-filtered metrics
- GET /api/ai-approvals/autonomy?domain=<group> — returns per-domain autonomy data (NOT per message type)
- POST /api/ai-approvals/autonomy/:messageType — accepts communicationDomain in body
- POST /api/ai-approvals/:id/approve|edit-send|reject — now stores communicationDomain in feedback row
- POST /api/ai-approvals/:id/regenerate — domain-aware GPT regeneration
- GET /api/ai-approvals/learning-rules — active rules
- PATCH /api/ai-approvals/learning-rules/:ruleId — archive / make global
- GET /api/ai-approvals/learning-dashboard — per-domain rules, outcomes, mistakes

## UI (client/src/pages/admin-ai-approvals.tsx)
- Page title: "AI Communications Center"
- Domain tabs: All / Athlete Leads / Team Training / Schools / Organizations / Employment
- Domain badge on every proposal card (color-coded per domain)
- FeedbackChips: 10 quick-select coaching tags
- RejectDialog, EditSendDialog, RegenerateDialog: all support coaching feedback → async rule extraction
- AutonomyPanel: shows per-domain autonomy level, repeated mistakes, promote button
- LearningDashboard: collapsible, left nav by domain, shows do/avoid/tone/cta/length/outcomes/mistakes per domain
- Sidebar label: "AI Comms Center" (url stays /admin/ai-approvals)

## Gotcha: routes.ts large file
- `read` tool with offset > ~21200 returns wrong error → use `bash sed -n 'N,Mp' server/routes.ts`

**Why:** The read tool has an internal line-offset limit. bash/sed has no such limit.
