---
Document Type: Release / Rollback
Verification Status: Validated against source (Phases 0–2)
Last Reviewed: 2026-07-13
Owner: Platform Engineering + Kevin Ops
---

# Kevin Control Plane — Rollback Plan

The Kevin integration is **additive and feature-flagged**. Rollback has three
escalating levels; in almost all cases Level 1 is sufficient and requires no
redeploy.

## Level 1 — Feature flag off (seconds, no deploy)

**Use when:** Kevin is misbehaving, Hermes is unstable, or you want to halt all
Kevin activity immediately.

1. In Replit Secrets, set `KEVIN_INTEGRATION_ENABLED=false` (or delete it).
2. Restart the app.

**Result:** every `/api/kevin/*` route returns `unconfigured`/`503`, the BFF makes
zero outbound Hermes calls, and the Console renders a harmless `unconfigured` state.
No other subsystem is affected. Kevin data tables remain intact.

## Level 2 — Revert the code (one deploy)

**Use when:** you need the Kevin routes/UI gone entirely (e.g. to remove the Console
link), not just disabled.

1. Revert the release merge commit on the main branch:
   ```
   git revert -m 1 <merge_commit_sha>
   ```
   (or reset the branch to the pre-merge commit if not yet shared).
2. Redeploy.

**What this removes:** the `/admin/kevin` route + sidebar/command-palette entries,
`server/kevin-routes.ts` registration, and all `server/services/kevin-*` code. Because
every Kevin file is either **new** or an **additive edit**, the revert is clean and
touches no existing business logic.

**What this does NOT remove:** the `kevin_audit_events`, `kevin_sessions`, and
`kevin_runs` tables (see Level 3). They are inert once the code is gone.

## Level 3 — Drop Kevin data tables (optional, destructive)

**Use only when:** you want to fully remove Kevin's footprint from the database.
These tables are self-provisioning and outside the Drizzle schema, so dropping them is
safe and they would simply be recreated if the code returned.

```sql
-- Take a backup first. Irreversible.
DROP TABLE IF EXISTS kevin_runs;
DROP TABLE IF EXISTS kevin_sessions;
DROP TABLE IF EXISTS kevin_audit_events;
```

> Do **not** run Level 3 during this release. It is documented for completeness only.

## Rollback verification

After any level:

- [ ] App boots and serves normally (`/` and existing admin pages load).
- [ ] Non-Kevin functionality (CRM, scheduling, billing, existing agents) unaffected.
- [ ] Level 1/2: `/api/kevin/health` returns `unconfigured` (L1) or `404` (L2).

## Blast radius summary

| Change | Reversible via | Data loss risk |
|--------|----------------|----------------|
| Feature flag | Env var toggle | None |
| Routes / UI / services | `git revert` of merge | None |
| DB tables | Manual `DROP` | Only Kevin audit/run history (never business data) |

The integration **cannot** affect athlete, billing, scheduling, or organization data:
it has no write path into any existing table and only reads aggregate context.
