---
name: Software KB Auto-Capture
description: DB-backed software_kb_entries table that auto-populates from real fixes; seeded with 13 historical fixes; wired into Software Improvement Agent; full Software KB tab on Org Memory page.
---

## Rule
The Software KB should primarily auto-populate from real platform fixes. Manual entry is secondary. A duplicate-check search must be shown before the manual form to prevent redundant entries.

**Why:** The KB was previously empty on first load — it either showed nothing or presented a blank form. The auto-capture philosophy means the table arrives pre-populated with real institutional knowledge.

**How to apply:** Any new fix path, audit resolution, or crash handler should call the appropriate wrapper from `server/services/software-kb-service.ts` in a fire-and-forget `try { ... } catch (_) {}` block.

## Key files
- `server/services/software-kb-service.ts` — full service: `ensureSoftwareKbTable()`, `recordSoftwareKbEntry()`, `getSoftwareKbEntries()`, `searchSoftwareKbEntries()`, `getSoftwareKbStats()`, `seedHistoricalFixes()`, plus 4 convenience wrappers (recordSoftwareImprovementFix, recordErrorBoundaryEvent, recordTypeScriptFix, recordDeploymentFix).
- `server/software-improvement-routes.ts` — wired recordSoftwareImprovementFix() into POST /api/software-improvement/tasks task creation.
- `client/src/pages/admin-organizational-memory.tsx` — new "Software KB" tab (tab id: "software-kb") added between "Decisions" and "Lessons Learned".

## Backend endpoints (5 new)
- `GET /api/organizational-memory/software-kb` — list entries (severity/sourceType/limit/offset filters)
- `GET /api/organizational-memory/software-kb/stats` — KPI summary (total, criticalCount, highCount, mediumCount, lowCount, last7DaysCount, bySourceType, bySeverity)
- `GET /api/organizational-memory/software-kb/search` — full-text search across issue, root_cause, fix_applied, files_modified, outcome, source
- `POST /api/organizational-memory/software-kb/record` — manual entry
- `POST /api/organizational-memory/software-kb/error-boundary` — frontend error boundary events (no ADMIN role required)

## Table schema
`software_kb_entries` created lazily via `ensureSoftwareKbTable()` on first use (not in Drizzle schema). Fields: id, org_id, severity, issue, root_cause, fix_applied, files_modified, outcome, source, source_type, related_entity_type, related_entity_id, metadata (jsonb), created_at, updated_at.

## Seeding
`seedHistoricalFixes("default")` called once as IIFE inside registerRoutes(); checks if count > 0 before inserting. Seeds 13 real historical fixes documented in project memory: route registration order, CEO heartbeat lock bug, dashboard card shapes, integration status dual system, Drizzle execute shape, scheduling agent bugs, ReactNode import, Obsidian URL encoding, agent state persistence, wallet idempotency, communication safety, department OS module imports, and decision journal implementation.

## SQL pattern note
All dynamic queries use Drizzle `sql` template literals with conditional `sql` fragments (e.g., `${orgId ? sql\`AND org_id = ${orgId}\` : sql\`\`}`). Never use `sql.raw()` with array params — that's a different pattern that doesn't work the same way in this codebase.

## UI features
- **Duplicate-check panel** — visible by default when form is hidden; searches KB as you type (≥3 chars); shows top 3 similar issues; green "safe to add" message when no matches
- **KPI row** — 8 stats (Total, Critical, High, Medium, Low, This Week, Auto-Captured, Manual)
- **Severity filter pills** — All / Critical / High / Medium / Low with counts
- **Source type badges** — top 6 sources displayed as read-only pills
- **Rich cards** — expandable to show fix applied, files modified (monospace), outcome, and source
- **Manual form** — hidden behind "Record Fix" button; reveals over duplicate-check panel
