---
name: Department OS v2 — Extraction Sprint
description: Architecture of the 5 framework subdirectories extracted in the v2 sprint. Covers file locations, name conflict rules, and migration pattern.
---

## Framework Subdirectories (v2)

All under `server/frameworks/department-os/{subdir}/`:

| Subdir | Files | Key exports |
|---|---|---|
| `pipeline/` | 4 | PipelineStage, DepartmentPipeline, PipelineMetrics, calculateStageCounts, calculateConversionRates, staleStageCheck, pipelineVolumeCheck |
| `assessment/` | 4 | AssessmentResult, BaseScoringEngine, compositeScore, scoreKeywords, actionFromScore |
| `learning-engine/` | 4 | Signal, Insight, LearningReport, calculateReplyRate, calculateConversionRate, calculateSourcePerformance, generateStandardInsights |
| `executive-engine/` | 5 | BestActionCandidate, rankBestActions, candidate, prioritizeRecommendations, composeBrief, PRIORITY_ORDER |
| `health-engine/` | 3 | HealthRule, DepartmentHealthEngine, departmentHealthEngine, defineRule |

Frontend: `shared/dashboard-framework.ts` — DepartmentMetric, DepartmentAlert, DepartmentSummaryCard, DepartmentDashboardCard

## Critical: Name conflict rule

The v2 subdirectory modules are NOT re-exported from the main barrel `server/frameworks/department-os/index.ts`.
Departments import directly from subdirectory paths:
```ts
import { PipelineStage } from "../frameworks/department-os/pipeline"
import { Signal, Insight } from "../frameworks/department-os/learning-engine"
import { departmentHealthEngine } from "../frameworks/department-os/health-engine"
```

**Why:** The v1 barrel already exports `ExecutiveBrief`, `BestAction`, `ActionPriority`, `RecommendationStatus`, `ConfidenceBand`, etc. Re-exporting the v2 subdirectories through the barrel causes duplicate export errors. The executive-engine/index.ts re-exports v1 types FROM their original files (not re-definitions) and adds only new items (BestActionCandidate, PRIORITY_ORDER, rankBestActions).

## `pct` helper naming

- `pipeline/pipeline-engine.ts` exports `pctOf()` (not `pct` — avoids barrel conflict)
- `learning-engine/learning-metrics.ts` has internal-only `pct()` (not exported)
- `n()` was renamed to `toNum()` in pipeline-engine.ts

## Migrations applied

- `hiring-department-coordinator.ts`: `createAttentionItems()` → `departmentHealthEngine.createAttentionItemsFromFailed()`
- `hiring-learning-agent.ts`: exports `HiringLearningInsightV2` alias pointing to framework `Insight`
- `hiring-executive-agent.ts`: `total` field typed with `as number` to fix reduce inference

## Preserved (not migrated)

- `opportunity-executive-coordinator.ts`: OpportunityHealthCheck preserved (has source-ID deduplication not in framework)
- `opportunity-learning-agent.ts`: LearningMetrics preserved (AI-enhanced, OpenAI-integrated)

## Scorecard page + route

- Backend: `server/department-os-v2-routes.ts` — static report, 2 endpoints: `/api/department-os/v2/extraction-report`, `/api/department-os/v2/framework-status`
- Frontend: `client/src/pages/admin-department-os-v2.tsx` — 6 tabs: Scorecard, Framework Modules, Duplication Audit, Migrations, Future Estimates, v2 Audit Report
- Route: `/admin/department-os-v2`, sidebar: "Department OS v2" with Layers icon (Layers already imported in app-sidebar.tsx)
- Routes registered at end of `registerRoutes()` in `server/routes.ts`

## Future department build cost

Department #3 requires: ~250 lines (data model + scoring + coordinator). Everything else already in framework. 72–78% savings vs pre-framework.
