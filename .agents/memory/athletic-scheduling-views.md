---
name: Athletic Scheduling Views + Recurrence
description: Week/month views, weekly recurring bookings, and public series delete on the athletic scheduling page
---

- Public program page at /org/:slug/athletic/:programSlug (client/src/pages/athletic-scheduling.tsx) has Day/Week/Month views; week/month use GET /api/athletic/bookings/range.
- Recurring bookings: POST /api/athletic/bookings accepts `repeatWeeks` (capped 26) and materializes weekly occurrences sharing a `recurrence_id` (column added to athletic_bookings via executeSql + schema.ts). Full/out-of-hours occurrences are skipped and reported in `recurrenceSkipped`.
- **Capacity is race-protected** by `pg_advisory_xact_lock(hashtext('athletic:<programId>|<date>|<slot>'))` inside a db.transaction around count+insert. Any new athletic booking path must go through this pattern or slots can overbook.
- **DELETE parity rule:** delete is public (matches page access model — user explicitly wanted anyone with page access to delete), but mirrors POST's `requireLoginToBook` org-token enforcement. `?scope=series` deletes the occurrence + all future ones in the recurrence.
- **Why:** code review flagged that a public DELETE without login parity was an authz hole; also flagged `toISOString().slice(0,10)` for local schedule dates — always format server-side dates from local components (getFullYear/Month/Date), never through UTC.
