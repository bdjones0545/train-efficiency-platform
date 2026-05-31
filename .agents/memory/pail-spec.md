---
name: PAIL — Persistent Athlete Intelligence Layer
description: 3 new DB tables, learning engine, coach note intelligence, memory-enriched TrainChat context, CEO Heartbeat PAIL risk section, and /admin/athlete-intelligence dashboard. End-to-end audited 55/55 (100%).
---

## Architecture

**Tables (all created via executeSql AND defined in shared/schema.ts):**
- `athlete_memory_profiles` — long-term athlete memory: preferences, movement, readiness, adaptation, injury, coach intelligence, autonomy trust level (0-3)
- `athlete_session_outcomes` — per-session outcome recording (completion, PRs, readiness delta, compliance, RPE)
- `exercise_effectiveness_scores` — per-athlete per-exercise effectiveness (0-100) calculated from completion rate, progression, PR rate, soreness, pain

**Services:**
- `server/services/athlete-learning-engine.ts`
  - `synthesizeAthleteIntelligence(athleteUserId, orgId)` → `LearningResult { athleteUserId, orgId, sessionsAnalyzed, exercisesAnalyzed, patternsFound, memoryConfidence, effectivenessScoresUpdated }`
  - `recalculateExerciseEffectiveness(athleteUserId, orgId)` → `number` (count of exercises scored)
  - `runAthleteLearningSynthesisForOrg(orgId)` → `{ athletes: number, errors: number }`
- `server/services/coach-note-intelligence-service.ts`
  - `analyzeCoachNotesForAthlete(athleteUserId, orgId)` → `CoachNoteIntelligence | null`; reads from athleteContextObjects.coachNotes JSONB array; returns null if no notes exist

**CRITICAL: ALL function signatures are (athleteUserId, orgId) — NOT (orgId, athleteUserId)**

**Context Broker Enhancement:**
- `buildMemoryEnrichedContextString(context, athleteUserId, orgId)` — first arg is full AthleteContextObject, NOT just IDs
- Wired into workout-builder-routes.ts at BOTH TrainChat injection points
- Memory profile injection only fires if memoryConfidence >= 20 (enough data)

**PR Lift Entries:** `prLiftEntries` uses `userId` (not `athleteUserId`) in Drizzle schema. Learning engine must query `prLiftEntries.userId`, not `prLiftEntries.athleteUserId`.

**API Routes:** `server/athlete-intelligence-routes.ts` registered in server/routes.ts via `registerAthleteIntelligenceRoutes(app)`:
- GET /api/admin/athlete-intelligence/athletes
- GET/PUT /api/admin/athlete-intelligence/profile/:athleteUserId
- POST /api/admin/athlete-intelligence/synthesize/:athleteUserId
- POST /api/admin/athlete-intelligence/synthesize-org
- GET /api/admin/athlete-intelligence/effectiveness/:athleteUserId
- GET /api/admin/athlete-intelligence/session-outcomes/:athleteUserId
- POST /api/admin/athlete-intelligence/analyze-notes/:athleteUserId
- PUT /api/admin/athlete-intelligence/trust-level/:athleteUserId
- GET /api/admin/athlete-intelligence/adaptation-history/:athleteUserId
- POST /api/admin/athlete-intelligence/session-outcome

**CEO Heartbeat Integration:** Section 6 in buildPriorityList() with PAIL athlete risk priorities. Nested try/catch. Risk flag query uses 7-day window — flags older than 7 days won't surface.

**Frontend:** `/admin/athlete-intelligence` — 2-panel layout (athlete list + detail); 4 tabs (Memory, Effectiveness, Risk & Quality, Autonomy).

## DB Schema Fixes Applied (Critical for Next Sessions)

**job_execution_locks:** DB was created with wrong column names (`job_key`, `locked_by` etc.). Drizzle expects `org_id`, `job_name`, `lock_key`, `acquired_at`, `expires_at`, `released_at`, `status`. Table was dropped and recreated. If the CEO Heartbeat throws "column org_id does not exist" on every org, check this table first — `acquireJobLock()` is called before the main try-catch in `runHeartbeatCycle`.

**agent_operating_timeline:** DB was missing columns: `system_name`, `priority`, `requires_approval`, `approval_status`, `executed_at`, `outcome_status`, `metadata`. DB had `metadata_json` but Drizzle schema uses `metadata`. All missing columns added; `metadata` column added alongside `metadata_json`.

**ceo_heartbeat_runs:** DB was missing `priorities_generated` and `error_message` columns (present in Drizzle schema). Added via ALTER TABLE.

## Why

- PAIL tables must exist BEFORE the first CEO Heartbeat PAIL cycle runs
- `acquireJobLock` has no try-catch at its call site in `runHeartbeatCycle` — any DB error there escapes the entire heartbeat function
- Column schema mismatches between Drizzle definitions and actual DB table are silent at startup but fatal at runtime
