---
name: Department OS v1 + Hiring Department
description: Architecture of the Department OS framework and the Hiring Department as Department #2 validation.
---

## Department OS v1

**Location:** `server/frameworks/department-os/` (9 files)
**Shared types:** `shared/department-framework.ts`

### Key contracts
- `DepartmentCoordinator` interface (department-coordinator.ts) — `runHeartbeatReview()`, `generateSummary()`, `generateBestAction()`
- `HeartbeatReviewResult` — standard shape returned to CEO Heartbeat
- `DepartmentHealthCheck` — standard health check shape (id, department, severity, passed, title, detail, recommendation, checkedAt)
- `BestAction` — (department, title, description, priority, route, estimatedImpact?)

### Department Registry
- Singleton at `server/services/department-registry.ts`
- Departments auto-register via dynamic `import()` at module load
- CEO Heartbeat block #6 calls `departmentRegistry.runAllHeartbeatReviews(orgId)` — loops all registered departments
- New departments need only: implement `DepartmentCoordinator`, call `departmentRegistry.register(coordinator, meta)`

## Hiring Department (Department #2)

**Tables (7):** hiring_candidates, hiring_assessments, hiring_outreach_drafts, hiring_interviews, hiring_learning_signals, hiring_executive_briefs, hiring_recommendations

**Services:**
- `server/services/hiring-assessment-agent.ts` — deterministic scoring (experience level + source + position demand + notes quality)
- `server/services/hiring-outreach-agent.ts` — 4 template types, draft-only (no sending)
- `server/services/hiring-learning-agent.ts` — source/position breakdown, hire rate, insight generation
- `server/services/hiring-executive-agent.ts` — brief, recommendations, best action
- `server/services/hiring-department-coordinator.ts` — implements DepartmentCoordinator, exports `hiringDepartmentCoordinator` singleton

**Routes:** `server/hiring-routes.ts` — 14 endpoints under `/api/hiring/*`

**Page:** `client/src/pages/admin-hiring.tsx` — 6 tabs (Candidates, Assessments, Outreach, Pipeline, Learning, Executive Intelligence)

**Sidebar:** "Hiring Department" with Briefcase icon, added after "Opportunity Acquisition" (requires `Briefcase` in lucide-react imports — added)

**CEO Heartbeat integration:** Automatic via registry loop — no custom heartbeat code required.

## Important gotchas

- `server/routes.ts` exceeds 29k lines — `read` tool max offset is ~21k so use `bash sed -n` for specific lines
- Multi-line `sed -i` replacements often fail — use `python3 -c "content.replace(old, new)"` instead
- Department coordinator `import type` statements CAN be placed mid-file in TypeScript modules (compiler allows top-level imports anywhere)
- `Briefcase` icon must be explicitly added to sidebar lucide-react import block (not auto-imported)

**Why:** Validated that Department OS v1 framework is extensible — Hiring Department required zero changes to CEO Heartbeat, zero changes to registry core, and reused all framework contracts. New departments follow the same pattern.
