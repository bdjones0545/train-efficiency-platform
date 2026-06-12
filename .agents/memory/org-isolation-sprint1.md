---
name: Org Isolation Sprint 1
description: Security hardening — canonical resolveOrgIdOrThrow pattern, rate limiting, isolation tests, startup audit.
---

# Org Isolation Sprint 1 — Security Hardening

## Core rule
**Never let a route resolve orgId to `""`.** Every failure must produce a 403.

## Canonical resolution path
`server/lib/resolve-org-id.ts` exports:
- `resolveOrgIdOrThrow(req)` — throws `OrgResolutionError` (→ 403) on failure; never returns `""`
- `handleOrgError(err, res)` — inline catch helper: returns `true` + sends 403 if OrgResolutionError, else `false`
- `orgErrorMiddleware` — Express 4-arg error middleware; add via `app.use(orgErrorMiddleware)` BEFORE generic error handler in `server/index.ts`
- `OrgResolutionError`, `isOrgResolutionError` — error type + type guard

## Resolution order inside resolveOrgIdOrThrow
1. `resolveOrgSession` (X-Org-Auth-Token / OIDC / Bearer)
2. Direct DB lookup: `userProfiles` then `coachProfiles`

## Catch block pattern (required for every route that uses resolveOrgIdOrThrow)
```ts
} catch (err: any) {
  if (handleOrgError(err, res)) return;
  res.status(500).json({ message: err.message });
}
```
The `orgErrorMiddleware` in index.ts only fires when `next(err)` is called — inline handlers must use `handleOrgError` explicitly.

## Public endpoint rate limiting
`server/middleware/public-rate-limiter.ts` — in-memory sliding window, factory: `publicRateLimiter(maxReqs, windowMs, key)`.
Applied to `/api/coaches` (120/min), `/api/availability` (60/min), `/api/services` (60/min) in routes.ts.

## Startup audit
`server/lib/startup-org-audit.ts` → `runStartupOrgAudit(app)` called in `server/index.ts` just before `httpServer.listen`.
Prints a banner; note: route count shows 0 due to Express router traversal timing — cosmetic only, does not affect security.

## Files fixed (removed `?? ""` fallback)
- `server/partnership-routes.ts` — all handlers
- `server/sponsorship-routes.ts` — all handlers
- `server/department-command-center-routes.ts` — all handlers
- `server/opportunity-acquisition-routes.ts` — all ~38 handlers
- `server/routes.ts` — connector routes (5), attention routes (3), public booking endpoints (3 rate-limited)
- `server/email-notification-routes.ts` — removed `|| req.query.orgId` fallback

## Scaffold template fixed
`server/frameworks/department-os/builder/department-scaffold.ts` — removed `getOrgId()` helper using `?? ""` pattern; generated departments must import `resolveOrgIdOrThrow` from `./lib/resolve-org-id` instead.

## Test suite
`server/__tests__/organization-isolation.spec.ts` — 13 tests, 6 suites using `node:test` + `node:assert`.
Run: `npx tsx --test server/__tests__/organization-isolation.spec.ts`
All 13 pass including: public-endpoint 400s, protected-endpoint 401s, 429 rate-limit burst (65 requests against 60/min), OrgResolutionError field assertions.

**Why:** Cross-org data leakage was possible when `getOrgContextForUser(userId).then(r => r?.orgId ?? "")` returned `""` and DB queries silently matched all rows with `orgId = ""` or returned unscoped data.
