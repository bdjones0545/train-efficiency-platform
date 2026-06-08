---
name: Department OS v2 Factory
description: Department Builder System — builder files, verified framework API contracts, factory dashboard, and 13 API gotchas registry.
---

## Location
`server/frameworks/department-os/builder/` — 5 files: department-template.ts, department-checklist.ts, department-builder-guide.ts, department-scaffold.ts, index.ts

Dashboard: `/admin/department-factory` (5 tabs: Overview, Scaffold, Guide, Maturity, Checklist)
Routes: `server/department-factory-routes.ts` registered inside `registerRoutes()` in routes.ts

## Critical Verified Framework APIs (Department OS v2)

### departmentRegistry.register()
- **2 args required**: `register(coordinator, meta: { name, description, version, enabled, discoveryEnabled, outreachEnabled, executionEnabled, learningEnabled, executiveEnabled })`

### candidate() / rankBestActions()
- `candidate(condition, action, priorityScore?)` — action is `Omit<BestAction,'department'>` (NO department field)
- `rankBestActions(departmentId: string, candidates[])` — department string is FIRST arg

### BestAction shape
- `{ department, title, description, priority, route, estimatedImpact? }` — NOT action/why/source

### composeBrief()
- Field is `bestActionToday` NOT `bestAction` or `action`

### Signal type (learning-engine)
- `responded` NOT `replied`
- `won` + `terminal` NOT `declined` (terminal=true, won=false for losses)

### buildLearningReport()
- 5 positional args: `(departmentId, orgId, signals, totalEntities, insights)`

### generateStandardInsights()
- Config object: `{ department, orgId, entityLabel, signals, totalEntities, ... }` NOT positional args

### DepartmentHealthCheck (v2)
- `passed: boolean` NOT `status: 'failed'/'passed'`
- `title/detail/recommendation` NOT `name/message/suggestedAction`
- `checkedAt: Date` NOT string

### HeartbeatReviewResult
- Fields: `checksRun, checksPassed, alertsCreated, executiveSummary, healthChecks`
- NO `attentionItems` field — removed in v2

### DepartmentSummaryResult
- Fields: `departmentId, departmentName, executiveSummary, metrics, bestAction, generatedAt`
- NO `status` or `highlights` fields

### createAttentionItemsFromFailed()
- 4 args: `(orgId, agentName, sourceSystem, checks)` returns `Promise<number>`

### scoreKeywords()
- `rules: KeywordRule[]` where `KeywordRule = { keywords: string[], points: number }` NOT `string[]`

### Dynamic imports in routes
- Use static imports at top of file — NOT dynamic import().then() chains (TS strict-mode errors)

## **Why:**
Every one of these was a real TypeScript error encountered during Departments #2 and #3. The factory documents all gotchas so future departments compile clean on first pass.

## **How to apply:**
Before writing any Department OS v2 file, read department-builder-guide.ts API_GOTCHAS array. Run `tsc --noEmit --skipLibCheck` on the 6 department files after writing them.
