---
name: Intelligent Lead Intake Pipeline
description: How AI lead scoring, intake profiling, and Gmail draft generation work after a form submission.
---

## Architecture

Every `POST /api/public/lead-capture/:orgSlug/:programSlug/submit` fires a non-blocking call to `runIntelligentLeadIntakePipeline()` from `server/services/intelligent-lead-intake-service.ts` AFTER the HTTP 201 response is already sent.

The pipeline:
1. Heuristic lead scoring (0–100, temperature: hot/warm/cold)
2. AI summary via `gpt-4o-mini`
3. Suggested next action determination
4. Normalized profile object construction
5. Personalized outreach draft via `gpt-4o-mini` (JSON format)
6. Persist `lead_intelligence_profiles` record (upsert on submissionId)
7. Insert `gmail_agent_actions` draft (status=proposed, approval required)
8. Schedule follow-up window (nextFollowUpAt = +24h)

## Key Table

`lead_intelligence_profiles` — created via direct SQL (drizzle-kit push has interactive prompt issues in CI). Schema is defined in `shared/schema.ts` at the end of the file.

**Why:** drizzle-kit push prompts interactively for new tables, so the table was created with `executeSql` instead.

## Routes Added

- `GET /api/lead-capture/intelligence` — all profiles for org (pipeline view)
- `GET /api/lead-capture/intelligence/:submissionId` — single profile
- `PATCH /api/lead-capture/intelligence/:id/stage` — update pipeline stage
- `POST /api/lead-capture/intelligence/:submissionId/reprocess` — re-run pipeline
- `POST /api/lead-capture/intelligence/test-simulation` — test with fake payloads
- `GET /api/lead-capture/intelligence/:submissionId/drafts` — Gmail drafts for a lead
- `PATCH /api/gmail-agent-actions/:id/status` — approve/dismiss a draft
- `GET /api/lead-capture/intelligence-stats` — pipeline stats by stage/temperature

## UI

`client/src/pages/admin-lead-pipeline.tsx` — Kanban pipeline board at `/admin/lead-pipeline`. Added to `app-sidebar.tsx` under "Growth & Revenue" (admin only) and registered in `App.tsx`.

## Safety

All Gmail drafts are `status=proposed`, `approvalRequired=true`. No autonomous sends.
