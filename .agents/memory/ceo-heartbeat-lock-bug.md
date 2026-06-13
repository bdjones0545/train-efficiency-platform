---
name: CEO Heartbeat Lock Bug
description: releaseJobLock was UPDATE not DELETE — caused manual runs to always be blocked within same 28-min window
---

## The Rule
`releaseJobLock` must DELETE the row from `job_execution_locks`, not UPDATE it to `status = 'released'`.

**Why:** The lock key is time-bucketed: `${orgId}:ceo_heartbeat:${Math.floor(now / 28min)}`. If the row is left alive (even as "released"), the next INSERT in the same 28-minute window hits the UNIQUE constraint. The takeover UPDATE then fails because `expiresAt` is not yet in the past — so `acquired: false` is returned and the manual run is silently blocked. `runId` comes back as `""`, `run` comes back as `null`, and the UI shows "—" for Last Heartbeat.

**How to apply:** Any time you add or modify `releaseJobLock` or a similar mutex pattern — always DELETE, never soft-update to a "released" state when the lock key is uniquely constrained on that same time-bucket.

## Symptoms
- Toast says "Heartbeat cycle started" + "Your operational baseline has been established"
- Last Heartbeat shows "—" and Agents Coordinated shows "—"
- DB actually has completed runs — the problem is the manual run is blocked before it even inserts

## Fix applied
1. `releaseJobLock` changed from `UPDATE … SET status='released'` to `DELETE`
2. Startup cleanup: `DELETE FROM job_execution_locks WHERE status = 'released'` fires once on `startCeoHeartbeat()` to purge any rows left over from before the fix
3. Frontend `onSuccess` detects the lock-blocked case (`data.success === false && errors includes "Lock already held"`) and shows "Heartbeat already running" instead of the confusing first-run message
