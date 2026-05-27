---
name: Scheduling agent service bugs
description: Known bugs fixed in internal-scheduling-agent-service.ts — enum case, coach name lookup, programGoals type guard.
---

## booking_status enum is UPPERCASE

The `booking_status` PostgreSQL enum has uppercase values: `PENDING, CONFIRMED, CANCELLED, COMPLETED, NO_SHOW, RESCHEDULED`.

The `getExistingBookings` and conflict-check queries in `internal-scheduling-agent-service.ts` used lowercase `"cancelled"` which caused a DB error. Fixed to `"CANCELLED"`.

**Why:** Drizzle doesn't enforce the enum case at the TS layer when using `as any` casts, so the wrong-case value passes TypeScript but explodes at runtime.

**How to apply:** Any query filtering by `bookings.status` must use the uppercase enum values.

## getCoachName must use Drizzle join, not db.execute

`db.execute(sql`SELECT ... FROM users ...`)` returns a `QueryResult` object whose structure varies by driver. Accessing rows via destructuring or `result.rows` is fragile.

Fixed to use a proper Drizzle `innerJoin` with the `users` table imported from `@shared/models/auth`.

```typescript
import { users } from "@shared/models/auth";

const [row] = await db
  .select({ firstName: users.firstName, lastName: users.lastName })
  .from(coachProfiles)
  .innerJoin(users, eq(users.id, coachProfiles.userId))
  .where(eq(coachProfiles.id, coachId))
  .limit(1);
```

**Why:** `db.execute` row structure is driver-dependent and silently falls back to "Coach" on any mismatch.

## programGoals can be string or array

`LeadContext.programGoals` may arrive as a string (`"acceleration, speed"`) or as a string array (`["acceleration","speed"]`). Before calling `.toLowerCase()`, normalize it:

```typescript
const goalsStr = Array.isArray(leadContext.programGoals)
  ? (leadContext.programGoals as string[]).join(", ")
  : leadContext.programGoals || "";
```

**Why:** The intake pipeline stores goals as a string array in `RawIntakeData`, but some callers pass a pre-joined string.
