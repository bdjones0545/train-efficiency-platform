---
name: AI Approval Inbox + Message Learning
description: Tables, service, and routes for the AI approval inbox with conversational coaching feedback and rule extraction.
---

## Tables
- `agent_message_feedback` — extended with: coaching_feedback_text, feedback_tags (jsonb), extracted_preferences, extracted_avoid_rules, extracted_do_rules, applies_to_lead_type, applies_to_program, preference_strength, should_apply_globally
- `agent_message_learning_rules` — extracted rules per org (do/avoid/tone/cta/length), status: active/superseded/archived
- `agent_message_revisions` — revision history when admin uses "Regenerate with feedback"

## Service
`server/services/message-learning-service.ts`:
- `extractMessageLearningFromFeedback(orgId, feedbackId)` — calls GPT-4o-mini, stores rules async after any reject/edit
- `getMessageLearningContext(orgId, messageType, leadContext)` — returns formatted prompt block for injecting into generation
- `regenerateDraftWithFeedback(opts)` — calls OpenAI, stores revision, patches proposal bodyPreview
- `getLearningDashboard(orgId)` — per-message-type rules, rejection tags, repeated mistakes

## Routes (all in registerRoutes() in server/routes.ts)
- POST /api/ai-approvals/:id/approve — now accepts coachingFeedbackText, feedbackTags
- POST /api/ai-approvals/:id/edit-send — same
- POST /api/ai-approvals/:id/reject — same; requires reason OR coaching OR chips
- POST /api/ai-approvals/:id/regenerate — triggers GPT regeneration, patches proposal
- GET /api/ai-approvals/learning-rules — active rules for org
- PATCH /api/ai-approvals/learning-rules/:ruleId — update status/appliesGlobally/ruleText
- GET /api/ai-approvals/learning-dashboard — per-type learning data

## UI (client/src/pages/admin-ai-approvals.tsx)
- FeedbackChips: 10 quick-select chips in Reject and EditSend dialogs
- RejectDialog: requires reason OR coaching OR chips to submit
- EditSendDialog: coaching textarea + chips (optional)
- RegenerateDialog: feedback → GPT → shows revised draft → patches proposal
- LearningDashboard: collapsible, per-type do/avoid/tone/cta/length rules with archive/global controls
- AutonomyPanel: blocks promotion note for repeated mistakes

## Gotcha: routes.ts large file
- `read` tool with offset > ~21200 returns wrong "file length" error and shows last 50 lines
- Use `bash sed -n '21340,21460p' server/routes.ts` to read specific line ranges beyond 21200

**Why:** The read tool has an internal line-offset limit separate from file size. bash/sed has no such limit.
