---
name: PAIL — Persistent Athlete Intelligence Layer
description: 3 new DB tables, learning engine, coach note intelligence, memory-enriched TrainChat context, CEO Heartbeat PAIL risk section, and /admin/athlete-intelligence dashboard.
---

## Architecture

**Tables (all created via executeSql):**
- `athlete_memory_profiles` — long-term athlete memory: preferences, movement, readiness, adaptation, injury, coach intelligence, autonomy trust level (0-3)
- `athlete_session_outcomes` — per-session outcome recording (completion, PRs, readiness delta, compliance, RPE)
- `exercise_effectiveness_scores` — per-athlete per-exercise effectiveness (0-100) calculated from completion rate, progression, PR rate, soreness, pain

**Services:**
- `server/services/athlete-learning-engine.ts` — `synthesizeAthleteIntelligence(athleteUserId, orgId)` and `recalculateExerciseEffectiveness()` and `runAthleteLearningSynthesisForOrg(orgId)` cron function
- `server/services/coach-note-intelligence-service.ts` — `analyzeCoachNotesForAthlete()` reads from athleteContextObjects.coachNotes JSONB array

**Context Broker Enhancement:**
- `buildMemoryEnrichedContextString(context, athleteUserId, orgId)` added to athlete-context-broker.ts
- Wired into workout-builder-routes.ts at BOTH TrainChat injection points (lines ~373 and ~871)
- Memory profile injection only fires if memoryConfidence >= 20 (enough data)

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

**CEO Heartbeat Integration:** Section 6 added to buildPriorityList() with PAIL athlete risk priorities (critical flags, pain athletes, stalled progress, stale memory). Has its own nested try/catch.

**Frontend:** `/admin/athlete-intelligence` — 2-panel layout (athlete list + detail); 4 tabs (Memory, Effectiveness, Risk & Quality, Autonomy).

**Why:** PAIL tables must exist BEFORE the first CEO Heartbeat PAIL cycle runs. If heartbeat fires at startup before tables are created via executeSql, it fails silently (PAIL try/catch) but logs an error at the outer runHeartbeatCycle level. Always create tables FIRST, restart app second.
