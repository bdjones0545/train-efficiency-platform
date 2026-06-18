---
name: Scheduling Calendar Intelligence — Phase 3
description: Google Calendar + Scheduling Agent integration: 9 endpoints, 6 agent tools, dashboard panel, approval-gated writes.
---

## What was built

### New Files
- `server/services/scheduling-calendar-service.ts` — Core intelligence service (availability, conflict detection, time ranking, alerts, queue write ops)
- `server/scheduling-calendar-routes.ts` — 9 API endpoints registered inside registerRoutes()

### Endpoints (all under /api/scheduling-intelligence/calendar/)
| Method | Path | Type | Auth |
|---|---|---|---|
| GET | /availability | read, instant | COACH/ADMIN |
| GET | /events | read, instant | COACH/ADMIN |
| POST | /suggest-times | read, instant | COACH/ADMIN |
| POST | /detect-conflict | read, instant | COACH/ADMIN |
| POST | /book | write, approval-gated | COACH/ADMIN |
| POST | /reschedule | write, approval-gated | COACH/ADMIN |
| POST | /cancel | write, approval-gated | COACH/ADMIN |
| GET | /dashboard | aggregated, instant | COACH/ADMIN |
| GET | /alerts | instant | COACH/ADMIN |

### 6 New Scheduling Agent Tools (added to server/scheduling-assistant.ts)
Tool definitions appended to `const tools` array (after show_team_pipeline_summary), cases in executeTool() switch before `default:`:
- `schedule_find_availability` — findCalendarAvailability()
- `schedule_suggest_times` — findCalendarAvailability() + fetchCalendarEvents() + rankTimeSlots()
- `schedule_detect_conflicts` — detectSchedulingConflicts()
- `schedule_create_booking` — queueEventCreation() (approval-gated)
- `schedule_reschedule_booking` — queueEventUpdate() (approval-gated)
- `schedule_cancel_booking` — queueEventDeletion() (approval-gated)

### Dashboard Enhancement
`client/src/pages/admin-scheduling-command-center.tsx` — CalendarIntelligencePanel added between Intelligence Row and Main Content Grid. Shows: Availability Summary (Today/Tomorrow/Week), Scheduling Alerts (back-to-back, double-booking, high-util, long gap), Upcoming Events. Falls back gracefully if calendar not connected.

### Architecture Rules
- Read ops: call executeComposioAction directly from service (no approval gate)
- Write ops: go through requestComposioAction() → composio_calendar_requests table → approval queue
- All ops call emitComposioHermesEvent for learning/audit
- durationMinutes validation: min=1 max=480 (NOT 59 — sessions are 60+ min)
- `resolveOrgIdOrThrow(req)` used in all routes
- Routes registered in registerRoutes() right after registerComposioCalendarRoutes()

**Why:** Approval-gated writes prevent AI from autonomously mutating production Google Calendar. Read ops are instant (no user friction).
