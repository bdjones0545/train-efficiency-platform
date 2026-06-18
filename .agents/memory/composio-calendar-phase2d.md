---
name: Composio Google Calendar Phase 2D
description: Correct Composio v3.1 action slugs for Google Calendar and architecture of the approval-gated calendar integration.
---

## Correct action slugs (v3.1)
- `GOOGLECALENDAR_LIST_CALENDARS` — list connected calendars (no required params)
- `GOOGLECALENDAR_EVENTS_LIST` — list events on a calendar (old slug GOOGLECALENDAR_LIST_EVENTS does NOT exist)
- `GOOGLECALENDAR_EVENTS_GET` — get single event (old slug GOOGLECALENDAR_GET_EVENT does NOT exist)
- `GOOGLECALENDAR_FIND_FREE_SLOTS` — free/busy query (params: time_min, time_max, items, timezone)
- `GOOGLECALENDAR_CREATE_EVENT` — required: start_datetime; use end_datetime OR event_duration_hour+event_duration_minutes
- `GOOGLECALENDAR_UPDATE_EVENT` — required: start_datetime, event_id; calendar_id optional
- `GOOGLECALENDAR_DELETE_EVENT` — required: event_id; calendar_id optional
- Permanently blocked: GOOGLECALENDAR_CLEAR_CALENDAR, GOOGLECALENDAR_CALENDARS_DELETE, GOOGLECALENDAR_BATCH_EVENTS

## event_duration_minutes constraint
Must be 0-59 ONLY. Use event_duration_hour for hours. Never pass 60+ to event_duration_minutes.

## create_meeting_room
Defaults to True in Composio — pass `create_meeting_room: false` unless you want a Meet link.

## emitComposioHermesEvent result field
Only accepts: "success" | "failure" | "queued_for_approval" | "blocked"
Use "blocked" for human rejection (not "rejected" which is invalid and causes a TS error at startup).

## Routes
- `server/composio-calendar-routes.ts` — Phase 2D implementation
- Registered in `server/routes.ts` inside `registerRoutes()` after Slack routes (~line 30867)
- Table: `composio_calendar_requests`
- 9 endpoints: 3 read (no approval), 4 write request+queue, pending, all, approve, reject

## Connected account
- googlecalendar connected_account_id: ca_RZO_DbzEN-Lf
- entity: pg-test-d5dbc07d-e4b9-40d4-a024-8f1ddf8c1edf

**Why:** Stale slugs (LIST_EVENTS, GET_EVENT) in the registry caused silent failures — v3.1 API returns 404. Always verify slugs against /api/v3.1/tools/<slug> before registering.
